variable "YC_REGISTRY_ID" {}
variable "IMAGE_TAG" {}
variable "GITHUB_ACTIONS" {
  default = "false"
}

target "_base" {
  context    = "."
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64"]
  output     = ["type=image,oci-mediatypes=false"]
  # Yandex Registry rejects the index produced by BuildKit's default attestations.
  attest = [
    { type = "provenance", disabled = true },
    { type = "sbom", disabled = true },
  ]
  cache-from = GITHUB_ACTIONS == "true" ? ["type=gha,scope=platform-images"] : []
  cache-to   = GITHUB_ACTIONS == "true" ? ["type=gha,scope=platform-images,mode=max"] : []
}

target "api" {
  inherits = ["_base"]
  target   = "api"
  tags     = ["cr.yandex/${YC_REGISTRY_ID}/digital-autograph/api:${IMAGE_TAG}"]
}

target "web" {
  inherits = ["_base"]
  target   = "web"
  tags     = ["cr.yandex/${YC_REGISTRY_ID}/digital-autograph/web:${IMAGE_TAG}"]
}

target "worker" {
  inherits = ["_base"]
  target   = "worker"
  tags     = ["cr.yandex/${YC_REGISTRY_ID}/digital-autograph/worker:${IMAGE_TAG}"]
}

target "migration" {
  inherits = ["_base"]
  target   = "migration"
  tags     = ["cr.yandex/${YC_REGISTRY_ID}/digital-autograph/migration:${IMAGE_TAG}"]
}

group "release" {
  targets = ["api", "web", "worker", "migration"]
}
