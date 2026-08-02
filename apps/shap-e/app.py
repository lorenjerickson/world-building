import asyncio
import gc
import hashlib
import io
import logging
import os
import secrets
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from enum import Enum
from typing import Annotated, Any, Callable, Literal
from uuid import uuid4

import numpy as np
import torch
import trimesh
from fastapi import Body, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field
from shap_e.diffusion.gaussian_diffusion import diffusion_from_config
from shap_e.diffusion.k_diffusion import karras_sample_progressive
from shap_e.models.download import load_config, load_model
from shap_e.models.nn.camera import DifferentiableCameraBatch, DifferentiableProjectiveCamera
from shap_e.util.collections import AttrDict

LOGGER = logging.getLogger("shap-e-api")
MODEL_CACHE_DIR = os.getenv("SHAP_E_MODEL_CACHE", "/models")
ACCELERATOR = os.getenv("SHAP_E_ACCELERATOR", "auto").strip().lower()
DEVICE_REQUEST = os.getenv("SHAP_E_DEVICE", "auto").strip().lower()
MAX_UPLOAD_BYTES = int(os.getenv("SHAP_E_MAX_UPLOAD_BYTES", str(20 * 1024 * 1024)))
MAX_IMAGE_PIXELS = int(os.getenv("SHAP_E_MAX_IMAGE_PIXELS", "40000000"))
JOB_RETENTION_SECONDS = int(os.getenv("SHAP_E_JOB_RETENTION_SECONDS", "3600"))
MAX_RETAINED_JOBS = int(os.getenv("SHAP_E_MAX_RETAINED_JOBS", "50"))

Image.MAX_IMAGE_PIXELS = None


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class GenerationCancelled(Exception):
    pass


class TextGenerationRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=1000)
    guidance_scale: float = Field(default=15.0, ge=1.0, le=30.0)
    steps: int = Field(default=64, ge=8, le=128)
    seed: int | None = Field(default=None, ge=0, le=9_223_372_036_854_775_807)


class JobResponse(BaseModel):
    id: str
    inputType: Literal["image", "text"]
    status: JobStatus
    progress: int
    stage: str
    seed: int
    error: str | None = None


@dataclass
class ModelBundle:
    device: torch.device
    diffusion: Any | None = None
    image_model: Any | None = None
    text_model: Any | None = None
    transmitter: Any | None = None


@dataclass
class GenerationJob:
    id: str
    input_type: Literal["image", "text"]
    guidance_scale: float
    steps: int
    seed: int
    image: Image.Image | None = None
    prompt: str | None = None
    status: JobStatus = JobStatus.QUEUED
    progress: int = 0
    stage: str = "Queued"
    error: str | None = None
    artifact: bytes | None = None
    created_at: float = field(default_factory=time.monotonic)
    completed_at: float | None = None
    cancel_event: threading.Event = field(default_factory=threading.Event)

    def response(self) -> JobResponse:
        return JobResponse(
            id=self.id,
            inputType=self.input_type,
            status=self.status,
            progress=self.progress,
            stage=self.stage,
            seed=self.seed,
            error=self.error,
        )


def select_device() -> torch.device:
    if DEVICE_REQUEST == "cpu":
        return torch.device("cpu")
    if DEVICE_REQUEST not in {"auto", "cuda"}:
        raise RuntimeError("SHAP_E_DEVICE must be auto, cuda, or cpu")
    if torch.cuda.is_available():
        return torch.device("cuda")
    if DEVICE_REQUEST == "cuda":
        raise RuntimeError(f"{ACCELERATOR or 'GPU'} acceleration was requested but is unavailable")
    return torch.device("cpu")


def initialize_model_bundle() -> ModelBundle:
    device = select_device()
    LOGGER.info("Shap-E worker configured for %s (%s)", device, ACCELERATOR)
    return ModelBundle(device=device)


def release_conditioning_model(models: ModelBundle, keep: Literal["image", "text"]) -> None:
    if keep == "image" and models.text_model is not None:
        models.text_model = None
    elif keep == "text" and models.image_model is not None:
        models.image_model = None
    else:
        return
    gc.collect()
    if models.device.type == "cuda":
        torch.cuda.empty_cache()


def ensure_models(job: GenerationJob, models: ModelBundle) -> None:
    release_conditioning_model(models, job.input_type)
    if models.diffusion is None:
        job.stage = "Loading diffusion configuration"
        job.progress = 1
        models.diffusion = diffusion_from_config(
            load_config("diffusion", cache_dir=MODEL_CACHE_DIR),
        )
    if models.transmitter is None:
        job.stage = "Loading Shap-E mesh decoder"
        job.progress = 2
        models.transmitter = load_model(
            "transmitter",
            device=models.device,
            cache_dir=MODEL_CACHE_DIR,
        )
    if job.input_type == "image" and models.image_model is None:
        job.stage = "Loading image-to-3D model"
        job.progress = 3
        models.image_model = load_model(
            "image300M",
            device=models.device,
            cache_dir=MODEL_CACHE_DIR,
        )
    elif job.input_type == "text" and models.text_model is None:
        job.stage = "Loading text-to-3D model"
        job.progress = 3
        models.text_model = load_model(
            "text300M",
            device=models.device,
            cache_dir=MODEL_CACHE_DIR,
        )
    LOGGER.info("Models ready for %s-conditioned generation", job.input_type)


@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.jobs = {}
    application.state.queue = asyncio.Queue()
    application.state.models = initialize_model_bundle()
    worker = asyncio.create_task(job_worker(application), name="shap-e-job-worker")
    application.state.worker = worker
    yield
    worker.cancel()
    await asyncio.gather(worker, return_exceptions=True)
    application.state.models = None
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


app = FastAPI(
    title="Wanderlust Shap-E Service",
    description="Internal asynchronous text- and image-conditioned Shap-E generation.",
    version="2.0.0",
    lifespan=lifespan,
)


@app.get("/health", tags=["operations"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready", tags=["operations"])
async def ready() -> dict[str, str]:
    models: ModelBundle | None = getattr(app.state, "models", None)
    worker: asyncio.Task | None = getattr(app.state, "worker", None)
    if models is None or worker is None or worker.done():
        raise HTTPException(status_code=503, detail="Models or generation worker are not ready")
    return {
        "accelerator": ACCELERATOR,
        "device": models.device.type,
        "loadedModels": ",".join(
            name
            for name, loaded in (
                ("transmitter", models.transmitter),
                ("image300M", models.image_model),
                ("text300M", models.text_model),
            )
            if loaded is not None
        ),
        "status": "ready",
    }


async def read_source_image(upload: UploadFile) -> Image.Image:
    if upload.content_type and not (
        upload.content_type.startswith("image/") or upload.content_type == "application/octet-stream"
    ):
        raise HTTPException(status_code=415, detail="The uploaded file must be an image")

    image_bytes = await upload.read(MAX_UPLOAD_BYTES + 1)
    await upload.close()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="The uploaded image is empty")
    if len(image_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"The uploaded image exceeds the {MAX_UPLOAD_BYTES}-byte limit",
        )

    try:
        image = Image.open(io.BytesIO(image_bytes))
        if image.width * image.height > MAX_IMAGE_PIXELS:
            raise HTTPException(
                status_code=413,
                detail=f"The uploaded image exceeds the {MAX_IMAGE_PIXELS}-pixel limit",
            )
        image.load()
        return ImageOps.exif_transpose(image).convert("RGB")
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError) as error:
        raise HTTPException(status_code=400, detail="The uploaded image is invalid") from error


def create_mesh_cameras(device: torch.device) -> DifferentiableCameraBatch:
    origins = []
    xs = []
    ys = []
    zs = []
    for theta in np.linspace(0, 2 * np.pi, num=20):
        z = np.array([np.sin(theta), np.cos(theta), -0.5])
        z /= np.sqrt(np.sum(z**2))
        origin = -z * 4
        x = np.array([np.cos(theta), -np.sin(theta), 0.0])
        origins.append(origin)
        xs.append(x)
        ys.append(np.cross(z, x))
        zs.append(z)

    return DifferentiableCameraBatch(
        shape=(1, len(xs)),
        flat_camera=DifferentiableProjectiveCamera(
            origin=torch.from_numpy(np.stack(origins)).float().to(device),
            x=torch.from_numpy(np.stack(xs)).float().to(device),
            y=torch.from_numpy(np.stack(ys)).float().to(device),
            z=torch.from_numpy(np.stack(zs)).float().to(device),
            width=2,
            height=2,
            x_fov=0.7,
            y_fov=0.7,
        ),
    )


def sample_with_progress(
    *,
    models: ModelBundle,
    model: Any,
    model_kwargs: dict[str, Any],
    guidance_scale: float,
    steps: int,
    progress: Callable[[int], None],
    cancelled: Callable[[], bool],
) -> torch.Tensor:
    if models.diffusion is None:
        raise RuntimeError("The diffusion model is not loaded")
    if hasattr(model, "cached_model_kwargs"):
        model_kwargs = model.cached_model_kwargs(1, model_kwargs)
    if guidance_scale not in {0.0, 1.0}:
        for key, value in model_kwargs.copy().items():
            model_kwargs[key] = torch.cat([value, torch.zeros_like(value)], dim=0)

    use_fp16 = models.device.type == "cuda"
    sample = None
    with torch.autocast(device_type=models.device.type, enabled=use_fp16):
        for item in karras_sample_progressive(
            diffusion=models.diffusion,
            model=model,
            shape=(1, model.d_latent),
            steps=steps,
            clip_denoised=True,
            model_kwargs=model_kwargs,
            device=models.device,
            sigma_min=1e-3,
            sigma_max=160,
            s_churn=0,
            guidance_scale=guidance_scale,
            progress=False,
        ):
            if cancelled():
                raise GenerationCancelled
            sample = item["x"]
            if "i" in item:
                progress(int(item["i"]) + 1)
    if sample is None:
        raise RuntimeError("Shap-E did not produce a latent sample")
    return sample


def image_palette(image: Image.Image, count: int = 8) -> np.ndarray:
    quantized = image.copy()
    quantized.thumbnail((256, 256))
    quantized = quantized.quantize(colors=count, method=Image.Quantize.MEDIANCUT).convert("RGB")
    colors = quantized.getcolors(maxcolors=256 * 256) or []
    ordered = [color for _, color in sorted(colors, reverse=True)]
    return np.asarray(ordered[:count] or [(184, 132, 74)], dtype=np.uint8)


def prompt_palette(prompt: str, count: int = 8) -> np.ndarray:
    digest = hashlib.sha256(prompt.encode("utf-8")).digest()
    colors = []
    for index in range(count):
        offset = index * 3
        colors.append(tuple(55 + (digest[offset + channel] % 180) for channel in range(3)))
    return np.asarray(colors, dtype=np.uint8)


def mesh_vertex_colors(mesh: Any, fallback_palette: np.ndarray) -> np.ndarray:
    if mesh.has_vertex_colors():
        rgb = np.stack([mesh.vertex_channels[channel] for channel in "RGB"], axis=1)
        if np.nanmax(rgb) <= 1.0:
            rgb = rgb * 255.0
        rgb = np.nan_to_num(rgb, nan=0.0, posinf=255.0, neginf=0.0)
        rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    else:
        verts = np.asarray(mesh.verts)
        height = verts[:, 2]
        span = max(float(np.ptp(height)), 1e-6)
        normalized = (height - float(np.min(height))) / span
        indices = np.minimum(
            (normalized * len(fallback_palette)).astype(int),
            len(fallback_palette) - 1,
        )
        rgb = fallback_palette[indices]
    return np.column_stack([rgb, np.full((len(rgb),), 255, dtype=np.uint8)])


def export_glb(mesh: Any, fallback_palette: np.ndarray) -> bytes:
    # Shap-E meshes are Z-up. glTF and the Three.js viewer are Y-up.
    source = np.asarray(mesh.verts, dtype=np.float32)
    vertices = np.column_stack([source[:, 0], source[:, 2], -source[:, 1]])
    result = trimesh.Trimesh(
        vertices=vertices,
        faces=np.asarray(mesh.faces),
        vertex_colors=mesh_vertex_colors(mesh, fallback_palette),
        process=False,
    )
    result.remove_unreferenced_vertices()
    artifact = result.export(file_type="glb")
    return artifact if isinstance(artifact, bytes) else bytes(artifact)


def generate_glb(job: GenerationJob, models: ModelBundle) -> bytes:
    torch.manual_seed(job.seed)
    if models.device.type == "cuda":
        torch.cuda.manual_seed_all(job.seed)

    ensure_models(job, models)
    job.stage = "Preparing conditioning input"
    job.progress = 4
    if job.input_type == "image" and job.image is not None:
        model = models.image_model
        model_kwargs = {"images": [job.image]}
        palette = image_palette(job.image)
    elif job.input_type == "text" and job.prompt:
        model = models.text_model
        model_kwargs = {"texts": [job.prompt]}
        palette = prompt_palette(job.prompt)
    else:
        raise RuntimeError("The generation job has no conditioning input")
    if model is None or models.transmitter is None:
        raise RuntimeError("The required Shap-E models are not loaded")

    job.stage = "Sampling 3D latent"
    latents = sample_with_progress(
        models=models,
        model=model,
        model_kwargs=model_kwargs,
        guidance_scale=job.guidance_scale,
        steps=job.steps,
        progress=lambda step: setattr(job, "progress", 5 + round(80 * step / job.steps)),
        cancelled=job.cancel_event.is_set,
    )
    if job.cancel_event.is_set():
        raise GenerationCancelled

    job.stage = "Decoding mesh"
    job.progress = 88
    with torch.inference_mode():
        decoded = models.transmitter.renderer.render_views(
            AttrDict(cameras=create_mesh_cameras(models.device)),
            params=models.transmitter.encoder.bottleneck_to_params(latents[0][None]),
            options=AttrDict(rendering_mode="stf", render_with_direction=False),
        )
        mesh = decoded.raw_meshes[0].tri_mesh()

    job.stage = "Exporting colored GLB"
    job.progress = 95
    return export_glb(mesh, palette)


def cleanup_jobs(jobs: dict[str, GenerationJob]) -> None:
    completed = sorted(
        (
            job
            for job in jobs.values()
            if job.completed_at is not None
        ),
        key=lambda job: job.completed_at or 0,
    )
    cutoff = time.monotonic() - JOB_RETENTION_SECONDS
    for job in completed:
        if (job.completed_at or 0) < cutoff or len(jobs) > MAX_RETAINED_JOBS:
            jobs.pop(job.id, None)


async def job_worker(application: FastAPI) -> None:
    queue: asyncio.Queue[str] = application.state.queue
    jobs: dict[str, GenerationJob] = application.state.jobs
    while True:
        job_id = await queue.get()
        job = jobs.get(job_id)
        try:
            if job is None:
                continue
            if job.cancel_event.is_set():
                job.status = JobStatus.CANCELLED
                job.stage = "Cancelled"
                job.completed_at = time.monotonic()
                continue
            job.status = JobStatus.RUNNING
            job.artifact = await asyncio.to_thread(generate_glb, job, application.state.models)
            job.progress = 100
            job.stage = "Model ready"
            job.status = JobStatus.SUCCEEDED
            job.completed_at = time.monotonic()
        except GenerationCancelled:
            if job is not None:
                job.status = JobStatus.CANCELLED
                job.stage = "Cancelled"
                job.completed_at = time.monotonic()
        except Exception:
            LOGGER.exception("Shap-E generation job %s failed", job_id)
            if job is not None:
                job.error = "Shap-E could not generate this model"
                job.stage = "Generation failed"
                job.status = JobStatus.FAILED
                job.completed_at = time.monotonic()
        finally:
            queue.task_done()
            cleanup_jobs(jobs)


async def enqueue_job(job: GenerationJob) -> JobResponse:
    jobs: dict[str, GenerationJob] = app.state.jobs
    jobs[job.id] = job
    await app.state.queue.put(job.id)
    return job.response()


@app.post("/v1/jobs/text", response_model=JobResponse, status_code=202, tags=["generation"])
async def create_text_job(request: Annotated[TextGenerationRequest, Body()]) -> JobResponse:
    prompt = request.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="A non-empty text prompt is required")
    return await enqueue_job(GenerationJob(
        id=str(uuid4()),
        input_type="text",
        prompt=prompt,
        guidance_scale=request.guidance_scale,
        steps=request.steps,
        seed=request.seed if request.seed is not None else secrets.randbits(53),
    ))


@app.post("/v1/jobs/image", response_model=JobResponse, status_code=202, tags=["generation"])
async def create_image_job(
    image: Annotated[UploadFile, File(description="Source image with its background removed")],
    guidance_scale: Annotated[float, Query(ge=1.0, le=20.0)] = 3.0,
    steps: Annotated[int, Query(ge=8, le=128)] = 64,
    seed: Annotated[int | None, Query(ge=0, le=9_223_372_036_854_775_807)] = None,
) -> JobResponse:
    return await enqueue_job(GenerationJob(
        id=str(uuid4()),
        input_type="image",
        image=await read_source_image(image),
        guidance_scale=guidance_scale,
        steps=steps,
        seed=seed if seed is not None else secrets.randbits(53),
    ))


def require_job(job_id: str) -> GenerationJob:
    job: GenerationJob | None = app.state.jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Generation job not found")
    return job


@app.get("/v1/jobs/{job_id}", response_model=JobResponse, tags=["generation"])
async def get_job(job_id: str) -> JobResponse:
    return require_job(job_id).response()


@app.get(
    "/v1/jobs/{job_id}/artifact",
    response_class=Response,
    responses={200: {"content": {"model/gltf-binary": {}}}},
    tags=["generation"],
)
async def get_job_artifact(job_id: str) -> Response:
    job = require_job(job_id)
    if job.status != JobStatus.SUCCEEDED or job.artifact is None:
        raise HTTPException(status_code=409, detail="The generated model is not ready")
    return Response(
        content=job.artifact,
        media_type="model/gltf-binary",
        headers={
            "Content-Disposition": 'attachment; filename="character-token.glb"',
            "X-Shap-E-Accelerator": ACCELERATOR,
            "X-Shap-E-Seed": str(job.seed),
        },
    )


@app.delete("/v1/jobs/{job_id}", response_model=JobResponse, tags=["generation"])
async def cancel_job(job_id: str) -> JobResponse:
    job = require_job(job_id)
    if job.status in {JobStatus.QUEUED, JobStatus.RUNNING}:
        job.cancel_event.set()
        if job.status == JobStatus.QUEUED:
            job.status = JobStatus.CANCELLED
            job.stage = "Cancelled"
            job.completed_at = time.monotonic()
    return job.response()
