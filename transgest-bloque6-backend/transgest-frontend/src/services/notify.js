export function notify(message, type = "info", timeout) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("tms:notify", {
    detail: { message, type, timeout },
  }));
}

export function confirmDialog(options = {}) {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise(resolve => {
    window.dispatchEvent(new CustomEvent("tms:confirm", {
      detail: {
        title: options.title || "Confirmar accion",
        message: options.message || "",
        confirmText: options.confirmText || "Confirmar",
        cancelText: options.cancelText || "Cancelar",
        tone: options.tone || "default",
        resolve,
      },
    }));
  });
}

export function promptDialog(options = {}) {
  if (typeof window === "undefined") return Promise.resolve(null);
  return new Promise(resolve => {
    window.dispatchEvent(new CustomEvent("tms:prompt", {
      detail: {
        title: options.title || "Introducir dato",
        message: options.message || "",
        placeholder: options.placeholder || "",
        defaultValue: options.defaultValue || "",
        inputType: options.inputType || "text",
        confirmText: options.confirmText || "Aceptar",
        cancelText: options.cancelText || "Cancelar",
        tone: options.tone || "default",
        resolve,
      },
    }));
  });
}
