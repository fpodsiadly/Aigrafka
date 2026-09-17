from fastapi import APIRouter, HTTPException, Response, status

from app.core.config import get_settings
from app.core.result_images import get_result_image

router = APIRouter(prefix="/images", tags=["images"])


@router.get("/{token}", name="get_generated_image")
async def get_generated_image(token: str) -> Response:
    result = await get_result_image(token)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    content, mime_type = result
    return Response(
        content=content,
        media_type=mime_type,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": f"private, max-age={get_settings().result_image_ttl_seconds}",
            "X-Content-Type-Options": "nosniff",
        },
    )
