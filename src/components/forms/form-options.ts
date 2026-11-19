/**
 * When forms show validation errors: after the first save attempt, then live while typing.
 *
 * Not on blur ("onTouched"): an error appearing under a field you just left pushes everything
 * below it down while the mouse button is pressed, so the click lands somewhere else. A select,
 * date picker or picker under an empty required field then needed two clicks to open.
 */
export const formValidation = { mode: "onSubmit", reValidateMode: "onChange" } as const;
