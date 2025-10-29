# Niveles de mezcla recomendados

## Objetivo
Optimizar el balance entre instrumentos para evitar saturación y asegurar pegada, claridad y headroom en la mezcla.

## Valores sugeridos (`constants.ts`)
- **Kick**: 1.0 (máxima pegada, nunca menos de 0.9)
- **Snare**: 0.7
- **Clap**: 0.55
- **Low Tom**: 0.5
- **Mid Tom**: 0.5
- **High Tom**: 0.45
- **Closed Hi-hat**: 0.4
- **Open Hi-hat**: 0.25
- **Bassline**: 0.15 (bajo pero presente, para no tapar el bombo)
- **Master gain**: 0.85 (más headroom, menos saturación global)
- **FX sends** (reverb/delay/flanger): bajos por defecto para no ensuciar

## Recomendaciones
- El bombo debe ser el punto de referencia más fuerte.
- El bajo debe estar presente pero nunca tapar el bombo.
- Los platos y toms no deben sobresalir en la mezcla.
- Si la mezcla final sigue saturando, baja un poco más el `masterGain`.
- Ajusta los envíos a efectos según la mezcla que busques: poco reverb/delay para bombo, más para claps y platos.

## Edición avanzada
Puedes modificar los valores en `constants.ts` para experimentar con otros balances. Recuerda que el resultado óptimo depende del estilo musical y la dinámica de tu patrón.

---

_Actualizado automáticamente por GitHub Copilot el 2025-10-29._