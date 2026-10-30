"""The audio a session has heard so far."""

import numpy as np

from .model import SR


class AudioBuffer:
    """Whole-session audio, append-only. view() is safe to keep across appends.

    float32 at 16 kHz: ~230 MB per hour of session.
    """

    def __init__(self):
        self._data = np.zeros(SR * 60, np.float32)
        self.n = 0

    def append(self, frame: np.ndarray) -> None:
        if self.n + len(frame) > len(self._data):
            grown = np.zeros(len(self._data) * 2, np.float32)
            grown[: self.n] = self._data[: self.n]
            self._data = grown
        self._data[self.n : self.n + len(frame)] = frame
        self.n += len(frame)

    def view(self) -> np.ndarray:
        return self._data[: self.n]
