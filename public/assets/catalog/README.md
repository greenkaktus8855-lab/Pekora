# Pekora wearable 3D assets

Put wearable model files in this folder and use their public path in Owner Panel.

Example:
- File in this folder: `red-cap.glb`
- Model URL in Owner Panel: `/assets/catalog/red-cap.glb`

## Supported format

- Use binary glTF: `.glb`
- The model must be a mesh made for the Pekora block avatar preview.
- Use a model you made yourself or have permission to use.
- Do not upload executable files or scripts here.
- A preview image is optional and is separate from the 3D model.

## Attachment points

The attachment point is the origin for the uploaded model:

- `HeadTop` — hats and headwear
- `Head` — hair, face accessories
- `Torso` — torso accessories and 3D shirt meshes
- `Root` — lower-body accessories and full pants meshes
- `LeftArm`, `RightArm`, `LeftLeg`, `RightLeg` — limb accessories

Build the mesh around the selected attachment point. Keep the model near local coordinate (0, 0, 0), apply transforms before export, and use the Owner Panel scale, offset and rotation fields to fine-tune placement.

## Owner Panel workflow

1. Upload the `.glb` file into this folder and commit it to the repository.
2. Wait for the Cloudflare Worker/assets deployment to show Ready.
3. Open Pekora, sign in as OWNER, and open Panel.
4. Create an item and select `Wearable 3D (.glb)`.
5. Enter `/assets/catalog/your-file.glb` as the model URL.
6. Choose the matching category and attachment point, then save.
7. Purchase the item from the public catalog using site currency.
8. Open Avatar, select its category, and press Wear.

An image-only item is just a picture and cannot be equipped. The current preview renderer uses a simple block-style avatar, not the original Roblox/RCC character rig.
