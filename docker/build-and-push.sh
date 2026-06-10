#!/bin/bash
# ============================================================
# The Sweep — Docker Build & Push to GCP Artifact Registry
# ============================================================
# Builds the api and web images for linux/amd64 (the server's arch — the dev
# Mac is arm64, so we cross-build via buildx + QEMU) and pushes them.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"   # monorepo root = build context

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

REGISTRY="australia-southeast1-docker.pkg.dev/formal-triode-465902-n1/sweep"
VERSION="${VERSION:-latest}"
API_IMAGE="${REGISTRY}/sweep-api"
WEB_IMAGE="${REGISTRY}/sweep-web"
PLATFORM="linux/amd64"

info()  { echo -e "${YELLOW}ℹ $1${NC}"; }
ok()    { echo -e "${GREEN}✓ $1${NC}"; }
err()   { echo -e "${RED}✗ $1${NC}"; }
header(){ echo -e "\n${BLUE}========================================${NC}"; echo -e "${BLUE}$1${NC}"; echo -e "${BLUE}========================================${NC}\n"; }

check_docker() {
  header "Checking Docker"
  docker info >/dev/null 2>&1 || { err "Docker is not running."; exit 1; }
  ok "Docker is running"
}

check_gcloud() {
  header "Checking Google Cloud auth"
  command -v gcloud >/dev/null 2>&1 || { err "gcloud CLI not found."; exit 1; }
  gcloud auth print-access-token >/dev/null 2>&1 || { err "Not authenticated. Run: gcloud auth login"; exit 1; }
  gcloud auth configure-docker australia-southeast1-docker.pkg.dev --quiet
  ok "Authenticated with Google Cloud"
}

setup_buildx() {
  header "Setting up Docker Buildx"
  if ! docker buildx inspect sweep-builder >/dev/null 2>&1; then
    info "Creating buildx builder 'sweep-builder'..."
    docker buildx create --name sweep-builder --driver docker-container --bootstrap
  fi
  docker buildx use sweep-builder
  ok "Buildx builder ready"
}

build_image() {
  local image_name="$1" dockerfile="$2" service="$3"
  header "Building $service image ($PLATFORM)"
  info "Image:      $image_name:$VERSION"
  info "Dockerfile: $dockerfile"
  docker buildx build \
    --platform "$PLATFORM" \
    --file "$dockerfile" \
    --tag "$image_name:$VERSION" \
    --tag "$image_name:latest" \
    --push \
    "$PROJECT_DIR"
  ok "$service image built and pushed"
}

main() {
  header "The Sweep — Docker Build & Push"
  echo "  Registry: $REGISTRY"
  echo "  Version:  $VERSION"
  echo "  Platform: $PLATFORM"
  check_docker
  check_gcloud
  setup_buildx
  build_image "$API_IMAGE" "$PROJECT_DIR/api/Dockerfile" "API"
  build_image "$WEB_IMAGE" "$PROJECT_DIR/web/Dockerfile" "Web"
  header "Done"
  echo "  ${API_IMAGE}:${VERSION}"
  echo "  ${WEB_IMAGE}:${VERSION}"
  echo ""
  echo -e "${YELLOW}Next: on the server →${NC} cd /root/sweep && docker compose pull && docker compose up -d"
}

main "$@"
