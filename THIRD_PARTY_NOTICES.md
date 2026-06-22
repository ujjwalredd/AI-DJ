# Third-Party Notices

This repository contains code and assets with different license considerations.

## Source code

Project source code is licensed under the MIT License. See `LICENSE`.

## 3D controller model

The DJ controller model used by the frontend is stored at:

```text
frontend/public/models/dj-controller.glb
```

Attribution is stored at:

```text
frontend/public/models/ATTRIBUTION.txt
```

Current attribution:

```text
Model: DJ Turntable
Source: https://sketchfab.com/3d-models/dj-turntable-f8c13180b76b482cbde9ae2abcbf82ad
License: CC-BY 3.0 (https://creativecommons.org/licenses/by/3.0/)
Author: See original Sketchfab page for current author/profile details.
```

Do not replace or add 3D models, music files, images, videos, or fonts unless their licenses allow redistribution in this repository. Add attribution here or in a colocated attribution file.

## Downloaded audio

The `cache/` directory is ignored and should not be committed. Audio fetched by `yt-dlp` is runtime user/cache data, not source material distributed by this repository.

## npm dependencies

Dependency license details are recorded in `package-lock.json` and `frontend/package-lock.json`.
