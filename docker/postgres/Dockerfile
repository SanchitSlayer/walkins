# PostGIS plus pgvector. The upstream PostGIS image doesn't ship pgvector.
#
# This base is Debian bullseye, which the PostgreSQL apt repository has moved
# to its archive, so the repository address is repointed there. The base is
# kept rather than swapped for a newer or native-arm64 one because the data
# volume was created by it: changing the C library (collations) or CPU
# architecture under an existing data directory risks corrupting text indexes.
FROM postgis/postgis:16-3.4
RUN sed -i 's#apt.postgresql.org/pub/repos/apt#apt-archive.postgresql.org/pub/repos/apt#' /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-16-pgvector \
  && rm -rf /var/lib/apt/lists/*
