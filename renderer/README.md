# Sakura cloud avatar renderer

This folder deploys the avatar renderer as a separate Render Web Service while keeping the Sakura website and Cloudflare Worker in this repository.

## Render service settings

- Repository: greenkaktus8855-lab/Pekora
- Branch: main
- Root Directory: renderer
- Runtime: Docker
- Dockerfile Path: Dockerfile
- Health Check Path: /
- Public HTTP port: Render's PORT (defaults to 10000)

Add this secret in Render Environment:

- PEKORA_RENDERER_SECRET: a newly generated random value with at least 24 characters

Do not commit the secret to Git.

## Cloudflare Worker settings

Set:

- AVATAR_RENDERER_URL: the Render service HTTPS URL, for example https://sakura-renderer.onrender.com
- AVATAR_RENDERER_SECRET: exactly the same secret as PEKORA_RENDERER_SECRET

The RCCService SOAP port 64989 is used only inside the container. Do not expose it publicly.

## Important compatibility note

RCCService 2020 is a Windows executable and this container runs it through Wine on Linux. Wine compatibility is not guaranteed. Test the first deployment before choosing a paid Render plan. Render Free services sleep after 15 minutes without incoming traffic and can take about a minute to wake up.
