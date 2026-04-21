FROM python:3.12-slim

# P4: real PDF / DOCX extractors need native libs.
#   - libjpeg62-turbo + zlib1g: required by Pillow (pdfplumber's image path)
#   - poppler-utils: diagnostic fallback for malformed PDFs; safe to omit
#     if image size is a concern.
# slim base keeps the final image under ~250 MB.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libjpeg62-turbo \
      zlib1g \
      poppler-utils \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Healthcheck — targeting the /health endpoint. Keeps compose + k8s
# liveness probes trivial.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; \
    r=urllib.request.urlopen('http://127.0.0.1:8110/health',timeout=3); \
    sys.exit(0 if r.status==200 else 1)"

EXPOSE 8110
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8110"]
