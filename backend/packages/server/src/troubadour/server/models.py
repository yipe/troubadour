"""Request models shared by more than one router."""

from typing import Annotated

from pydantic import StringConstraints

Label = Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)]
