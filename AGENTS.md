# LYBELLE storefront guardrails

- Preserve the existing sage, dusty-rose, cream and indigo visual system.
- Keep French and Arabic feature parity; Arabic must use `dir="rtl"` and locally adapted copy.
- Use only supplied product imagery from `assets/`; do not replace products with placeholders.
- Do not add medical promises, invented reviews, fake scarcity, countdown timers or unsupported stock claims.
- Keep WhatsApp ordering configured through `STORE_CONFIG.whatsappNumber` and preserve `+212 604-442881` unless the manager changes it.
- Every product action must feed the same persistent cart engine; do not create parallel cart states.
- Keep the routine finder as general product orientation, never a diagnosis.
- Verify cart add/remove/quantity, checkout summary, FR/AR switching, finder, comparison and keyboard escape before release.
