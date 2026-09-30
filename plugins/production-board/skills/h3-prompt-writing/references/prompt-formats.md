# H3 prompt formats

These are concise plugin-authored templates and an original example. Field identifiers follow the upstream H3 prompt interface. Replace placeholders before delivering a final prompt. Do not include input paths, execution commands, or reviewer notes inside the generation prompt.

## Base modes: T2VA, I2VA, FL2VA, L2VA

Use these three fields in order:

```text
integrated_multimodal_description:
[Visual identity, setting, framing, and initial state.]
[0.0–A seconds: first action, camera behavior, and any synchronized speech.]
[A–B seconds: subsequent action and its physical consequence.]
[B–end seconds: concluding action and final composition.]

overall_soundscape:
[Ambient and action sounds; distinguish speech placement when needed.]

non_diegetic_music:
[Music direction, or N/A when no music is wanted.]
```

- I2VA: start from the supplied first frame; spend words on what moves next rather than redesigning it.
- FL2VA: keep both endpoints achievable; reach the final image by the end without a sudden identity or composition swap.
- L2VA: build toward the supplied final frame. Draft only in this plugin.
- T2VA: establish appearance and setting in text. Draft only in this plugin.

For dialogue, use a stable speaker marker such as `(S1)` and the form `<d>[Japanese] おはよう。</d>`. Put emotional delivery, lip synchronization, and voice qualities outside the spoken tag. Keep user-supplied wording and punctuation intact. When no one speaks, omit dialogue tags and speaker IDs.

### Original I2VA example: a short greeting

Assumptions for this example only: the supplied first image shows an adult courier at a quiet doorway; target duration is 5.875 seconds; dialogue is 「お待たせしました。」; no music. These are not default settings for other scenes.

```text
integrated_multimodal_description:
A hand-drawn anime shot continues directly from the supplied first frame. Keep the adult courier's face, clothing, proportions, doorway, and lighting consistent with the image. The camera stays fixed.
0.0–1.2 seconds: The courier settles their stance and looks toward the person just outside the frame.
1.2–3.8 seconds: The courier (S1) gives a small apologetic smile and speaks softly with synchronized mouth movement: <d>[Japanese] お待たせしました。</d>
3.8–5.875 seconds: Their mouth closes; they make a small polite nod and hold their gaze. Maintain the same framing through the end.

overall_soundscape:
Quiet room tone and a soft clothing rustle accompany the nod. The courier's voice is close and clear; no other speech.

non_diegetic_music:
N/A
```

For silent output, explicitly request no speech, ambient sound, effects, or music; use `N/A` in both sound fields. A separate downstream mute operation, if required, belongs in the execution plan, not a promise about prompt compliance.

## Full-reference drafts: Ref2VA

Use this ordered structure:

```text
subject_definitions:
[Map each subject to the supplied reference labels and its intended identity.]

summary:
[One concise description of the intended shot.]

retention_analysis:
[For each reference, state what to preserve and what may change.]

detailed_description:
[A timed account of action, camera, and dialogue.]

overall_soundscape:
[Ambient and synchronized sound direction.]

non_diegetic_music:
[Music direction or N/A.]
```

Use consistent labels such as `<Picture1>`, `<Video1>`, and `<Audio1>` only for actual supplied assets; keep a label-to-asset mapping outside the prompt. Separate identity, motion, composition, and voice references. Do not claim to have inspected inaccessible video/audio. Preserve user intent when references conflict; flag the conflict rather than inventing a missing reference.

Ref2VA is a drafting capability here. The current integrated runner does not execute these multi-reference inputs. For advanced reference timing, consult the linked official reference guide before specifying unsupported syntax.

## Before returning

Check that the timeline has one endpoint, supplied keyframes match their assigned endpoints, reference labels resolve, original dialogue is unchanged, and sound instructions agree. Keep mode and execution limitations outside the model prompt so the user can copy the prompt directly.
