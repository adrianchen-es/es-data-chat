# Re-export selected names from griffe._internal.enumerations to satisfy
# imports expecting a top-level _griffe package.
from griffe._internal.enumerations import DocstringSectionKind

__all__ = ["DocstringSectionKind"]
