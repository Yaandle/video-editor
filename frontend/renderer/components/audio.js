// audio — an uploaded audio file on the timeline. Not drawn; studio/audio/mix.py
// decodes and mixes it (gain, fades, source offset) into the master bus.

import { register } from '../registry.js';

register({
  type: 'audio',
  kind: 'component',
  label: 'Audio file',
  category: 'Audio',
  description: 'Narration, music or an effect from an uploaded file.',
  visual: false,
  media: 'audio',
  duration: 5,
  schema: {
    gain_db: { type: 'number', min: -60, max: 12, step: 0.5, default: 0, label: 'Gain dB' },
    fade_in: { type: 'number', min: 0, max: 10, step: 0.05, default: 0.02, label: 'Fade in s' },
    fade_out: { type: 'number', min: 0, max: 10, step: 0.05, default: 0.05, label: 'Fade out s' },
    duck_music: { type: 'bool', default: true, label: 'Duck music under this' },
  },
  label: (clip) => `audio · ${String(clip.src ?? '').split('/').pop()}`,
});
