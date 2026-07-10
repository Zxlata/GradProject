"""
Standard response envelope used by every endpoint.

Shape:

    {
      "success": true,
      "message": "Operation completed successfully",
      "data": { ... } | null,
      "errors": null | ["..."]
    }
"""

from __future__ import annotations

from typing import Any, Generic, List, Optional, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class ErrorDetail(BaseModel):
    """A single structured error entry."""

    code: str = Field(..., description="Short error code, e.g. 'validation_error'.")
    message: str = Field(..., description="Human-readable error description.")
    field: Optional[str] = Field(
        default=None, description="Offending field path, when applicable."
    )


class ApiResponse(BaseModel, Generic[T]):
    """Uniform response envelope for every endpoint."""

    success: bool = True
    message: str = "Operation completed successfully"
    data: Optional[T] = None
    errors: Optional[List[Any]] = None

    @classmethod
    def ok(
        cls,
        data: Optional[T] = None,
        message: str = "Operation completed successfully",
    ) -> "ApiResponse[T]":
        return cls(success=True, message=message, data=data, errors=None)

    @classmethod
    def fail(
        cls,
        message: str,
        errors: Optional[List[Any]] = None,
    ) -> "ApiResponse[T]":
        return cls(success=False, message=message, data=None, errors=errors)
