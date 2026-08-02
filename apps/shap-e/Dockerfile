# syntax=docker/dockerfile:1.7
# CPU-only default. GPU hosts use Dockerfile.nvidia or Dockerfile.amd.

FROM python:3.11-slim-bookworm AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY requirements.txt constraints.cpu-nvidia.txt ./
RUN python -m venv /opt/venv \
    && /opt/venv/bin/python -m pip install --no-cache-dir --upgrade pip setuptools wheel \
    && /opt/venv/bin/python -m pip install --no-cache-dir \
      torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cpu \
    && /opt/venv/bin/python -m pip install --no-cache-dir \
      -c constraints.cpu-nvidia.txt -r requirements.txt

COPY app.py .
RUN /opt/venv/bin/python -m compileall -q app.py


FROM python:3.11-slim-bookworm AS runtime

ENV PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    SHAP_E_ACCELERATOR=cpu \
    SHAP_E_DEVICE=cpu \
    SHAP_E_MODEL_CACHE=/models

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 shape \
    && useradd --uid 10001 --gid shape --create-home --shell /usr/sbin/nologin shape \
    && mkdir -p /app /models \
    && chown shape:shape /app /models

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder --chown=shape:shape /build/app.py /app/app.py

WORKDIR /app
USER shape
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15m --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/ready', timeout=4)"]
STOPSIGNAL SIGTERM
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
