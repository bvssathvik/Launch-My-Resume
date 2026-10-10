FROM python:3.11-slim

WORKDIR /srv/resumeforge

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY public ./public
COPY resume-templates ./resume-templates
COPY .env.example README.md ./

ENV JOB_STORE_PATH=/srv/resumeforge/data/jobs.json \
    PDF_ENABLED=true

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
