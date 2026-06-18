import time


class PlaybackController:

    def __init__(self, project):
        self.project = project
        self.playhead = 0.0
        self.playing = False

        self._last_tick = None

    def play(self):
        self.playing = True
        self._last_tick = time.time()

    def pause(self):
        self.playing = False

    def toggle(self):
        if self.playing:
            self.pause()
        else:
            self.play()

    def seek(self, t):
        self.playhead = max(
            0.0,
            min(t, self.project.duration)
        )

    def tick(self):
        if not self.playing:
            return self.playhead

        now = time.time()
        dt = now - self._last_tick
        self._last_tick = now

        self.playhead += dt

        if self.playhead >= self.project.duration:
            self.playhead = 0.0
            self.pause()

        return self.playhead