/**
 * The Vet At Your Door mark, prepared for the LabelWriter's 1-bit thermal head: derived
 * from public/vayd_icon.png, trimmed, squared, downscaled to 96px and thresholded to pure
 * black and white. Grayscale or dithered art turns muddy at this size, and the wordmark is
 * omitted because the practice name is already printed next to it.
 *
 * Inlined rather than fetched so label output stays deterministic and works offline.
 */
export const VAYD_LABEL_LOGO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgAQAAAADK40qVAAACJklEQVR42qWUv2oUURTGf/fMkh103V2sUixufIOATcDgDjZpLFJaprONqYM7YpHGdzBv4g0INhZ5hBuSImAgI4hOwt35LO7sZEVsdLpvfufce/58M07cPcY/i40VsahWxPd6RVS3K+L4Y0qVJGXVzPclA1gM8tCFxc21y05cFu6wyzmRvO9LSFJfqopWxKlU054WN2BtmRMkqWzJOUDRkpEkVYloE2CQLr0tutuls2Yu1aMjCemzz6TSnUtIU1ADryXUbMMswmQuVNcwqmA4k/G1hrqCm12Mqwp3FSC+xNgNDAcemnuY9jxjD3AfblSyndVAM+OnYN8pgD4gQWAeYH7dQxB4ewaMDXB/WVaDeQA8KNIHAsz0x06VSHeAa4kBmIeiJcWgdEAPcLhrO3iglljD+wKQGPEOmpAGvyjBna4nMjnp4z4dSkjl1vMM56etDy4ALsGg2PpBCTGVs3/RdIU+Du0SMXiYXvdSmEdADgaDEoAxWOoNqMCgWY4DgwitXQxqcKxTA1IAV75pXRXAOCCmFiBzgUwyBPTsOPktAsM+iSwFYNQAw65QmEwSOa2Ap2lD9iUAL2rIgScemAWYSlZ5cIvUkvXAFEP6BnfAbNPDTLISaPB3Puh9a+cWl6sOLcntN7u0Rz9aNYWgN14OfrwMS0MkZwR7gOXQEMpkmAjPJutQjSQaWBvmsH8kmYPbOoKPgEroj2Ark1DAHclz+Epy//t7+gWPGxdCuKNGPQAAAABJRU5ErkJggg==';
