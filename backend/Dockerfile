FROM python:3.11-slim


RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev gdal-bin libgdal-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000

# gthread/eventlet worker recommended once Flask-SocketIO is actively used
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "run:app"]

