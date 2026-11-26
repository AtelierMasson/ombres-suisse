#!/bin/sh
# Publie une nouvelle version sur topograph.ch : crée le tag du jour (v2026.11.26, puis v2026.11.26-2…) sur le
# dernier commit de main et l'envoie ; GitHub Actions construit et déploie (voir .github/workflows/infomaniak.yml).
set -e
git fetch --tags -q
base="v$(date +%Y.%m.%d)"; tag="$base"; k=2
while git rev-parse -q --verify "refs/tags/$tag" >/dev/null; do tag="$base-$k"; k=$((k + 1)); done
git tag -a "$tag" -m "Topograph $tag"
git push origin "$tag"
echo "Version $tag envoyée : suivi sur https://github.com/AtelierMasson/ombres-suisse/actions"
