from fastapi import APIRouter, UploadFile, File
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter()


class Heading(BaseModel):
    level: int
    text: str
    pageStart: Optional[int] = None


class ParseMetadata(BaseModel):
    pageCount: int
    headings: List[Heading]
    tableCount: int
    parserVersion: str
    sourceMimeType: str


class ParseResponse(BaseModel):
    markdown: str
    metadata: ParseMetadata


@router.post("/parse", response_model=ParseResponse)
async def parse(file: UploadFile = File(...)):
    raw = await file.read()
    text = (
        f"# {file.filename}\n\n"
        "## Section 1\n\n"
        f"Stub parser output for {len(raw)} bytes.\n\n"
        "## Section 2\n\nPlaceholder content for plumbing tests.\n"
    )
    return ParseResponse(
        markdown=text,
        metadata=ParseMetadata(
            pageCount=1,
            headings=[
                Heading(level=1, text=file.filename or "", pageStart=1),
                Heading(level=2, text="Section 1", pageStart=1),
                Heading(level=2, text="Section 2", pageStart=1),
            ],
            tableCount=0,
            parserVersion="stub-0.1",
            sourceMimeType=file.content_type or "application/octet-stream",
        ),
    )
