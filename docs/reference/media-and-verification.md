# Media and verification

Source: the Microsoft Evaluation Center link for Windows 11 Enterprise (English, United States),
`https://go.microsoft.com/fwlink/?LinkId=2382600`, which redirects to
`software-static.download.prss.microsoft.com`. The evaluation edition is licensed for testing and
needs no product key.

Microsoft publishes **no SHA-256** for evaluation ISOs, so `mvl media` verifies instead:

1. every redirect is followed by hand and the final URL must be HTTPS on `microsoft.com` or a
   subdomain of it;
2. the downloaded byte count is compared with the `Content-Length` Microsoft served; a difference
   is shown as a warning and recorded in the receipt (`lengthMatchesReported`), but does not fail
   on its own, because Microsoft refreshes these images and the size it reports can lag. Steps 3
   and 4 decide whether the image is used;
3. the ISO is mounted read-only and `setup.exe` and `sources\setup.exe` must carry a **valid**
   Authenticode signature from Microsoft Corporation; `sources\install.wim` or `.esd` must exist;
4. the SHA-256 is recorded in `media\media-en-us.json` and re-checked before every new machine.

Verified on 2026-11-17: `26300.9457.260913-1737.26h2_ge_release_svc_refresh_CLIENTENTERPRISEEVAL_OEMRET_x64FRE_en-us.iso`,
8,225,329,152 bytes, SHA-256 `bc3f24086ebadc94489066b5ad78089e2cf5c3491e90e790bb81a2b199c10e38`.
