# Local Shap-E generation service

This internal FastAPI service keeps OpenAI Shap-E's transmitter, text model, and
image model in memory. It processes one asynchronous generation job at a time
and exports a colored, Y-up GLB for the Three.js character-token viewer.

The browser never calls this service directly:

```text
Browser -> Next.js BFF -> NestJS -> Shap-E
                             |
                             +-> Payload CMS media
```

Shap-E has no access to Payload. NestJS supplies source-image bytes and stores a
completed GLB through the existing private Payload adapter.

## Model weights

The OpenAI weights are not included in any image. On first startup, Shap-E
downloads and hash-verifies them into the `shap_e_models` Docker volume. Later
starts reuse that cache. The container has a dedicated outbound-only bridge
network for this download. NestJS reaches the service over a separate internal
network; no Shap-E port is published.

`/health` reports process liveness and `/ready` reports worker availability.
Models are loaded lazily by the asynchronous worker so the HTTP service stays
available during first-use download and initialization. Only the transmitter
and the conditioning model required by the current job are resident at once;
switching between text and image jobs releases the previous conditioning model
before loading the next one.

## Linux runtime variants

CPU-only is the default:

```sh
docker compose up --build shap-e backend frontend
```

NVIDIA uses the CUDA image and Docker's NVIDIA runtime:

```sh
docker compose \
  -f docker-compose.yml \
  -f docker-compose.shap-e.nvidia.yml \
  up --build shap-e backend frontend
```

AMD uses AMD's validated ROCm/PyTorch image. The Linux host must expose
`/dev/kfd` and `/dev/dri`, and the GPU must be supported by the selected ROCm
release:

```sh
docker compose \
  -f docker-compose.yml \
  -f docker-compose.shap-e.amd.yml \
  up --build shap-e backend frontend
```

The implementations are deliberately separate:

- `Dockerfile.cpu`
- `Dockerfile.nvidia`
- `Dockerfile.amd`

`Dockerfile` is a CPU-compatible default for standalone builds.

## Internal API

- `POST /v1/jobs/text` creates a text-conditioned job.
- `POST /v1/jobs/image` creates an image-conditioned multipart job.
- `GET /v1/jobs/{id}` returns queue, diffusion, decoding, and export progress.
- `GET /v1/jobs/{id}/artifact` returns the completed GLB.
- `DELETE /v1/jobs/{id}` cancels a queued or running job.

Jobs and artifacts are held in memory and do not survive a container restart.
The service serializes inference to avoid GPU-memory contention.

Shap-E's generated RGB vertex channels are retained in the GLB. If a decoded
mesh has no colors, the exporter assigns vertex colors from a palette derived
from the source image. Text-only jobs use a deterministic prompt-derived palette
as their fallback.
