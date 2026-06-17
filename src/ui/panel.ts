import { FIELDS, type SupportParams } from "../params";

/** Формат числа: до 3 знаков после запятой, без хвостовых нулей. */
function fmt(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

export interface PanelCallbacks {
  onChange: (params: SupportParams) => void;
  onOk: () => void;
  onCancel: () => void;
  onExport: () => void;
}

export function buildPanel(
  host: HTMLElement,
  params: SupportParams,
  cb: PanelCallbacks
): { setStatus: (s: string) => void } {
  host.innerHTML = "";

  const list = document.createElement("div");
  list.className = "param-list";
  host.appendChild(list);

  let timer: number | undefined;
  const emit = () => {
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(() => cb.onChange({ ...params }), 120);
  };

  // Зависимые поля: Windows Offset активен только при включённой генерации окон.
  const numberInputs: Partial<Record<string, HTMLInputElement>> = {};
  const refreshDeps = () => {
    const off = numberInputs["windowsOffset"];
    if (!off) return;
    const disabled = !params.generateWindows;
    off.disabled = disabled;
    const lbl = off.previousElementSibling as HTMLElement | null;
    lbl?.classList.toggle("dim", disabled);
  };

  let prevGroup: string | null = null;
  for (const f of FIELDS) {
    // Тонкий разделитель + воздух между смысловыми группами.
    if (prevGroup !== null && f.group !== prevGroup) {
      const divider = document.createElement("div");
      divider.className = "param-divider";
      list.appendChild(divider);
    }
    prevGroup = f.group;

    const row = document.createElement("label");
    row.className = "param-row";

    const name = document.createElement("span");
    name.className = "param-label";
    name.textContent = f.label;
    row.appendChild(name);

    if (f.kind === "number") {
      const input = document.createElement("input");
      input.type = "number";
      input.className = "param-input";
      input.value = fmt(params[f.key] as number);
      if (f.step != null) input.step = String(f.step);
      if (f.min != null) input.min = String(f.min);
      input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        if (!Number.isNaN(v)) {
          (params[f.key] as number) = v;
          emit();
        }
      });
      // По потере фокуса нормализуем до 3 знаков после запятой.
      input.addEventListener("change", () => {
        const v = parseFloat(input.value);
        if (!Number.isNaN(v)) {
          const r = Math.round(v * 1000) / 1000;
          (params[f.key] as number) = r;
          input.value = fmt(r);
          emit();
        }
      });
      numberInputs[f.key] = input;
      row.appendChild(input);
    } else {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "param-toggle";
      const sync = () => toggle.classList.toggle("on", params[f.key] as boolean);
      sync();
      toggle.addEventListener("click", () => {
        (params[f.key] as boolean) = !(params[f.key] as boolean);
        sync();
        refreshDeps();
        emit();
      });
      row.appendChild(toggle);
    }
    list.appendChild(row);
  }
  refreshDeps();

  const status = document.createElement("div");
  status.className = "panel-status";
  host.appendChild(status);

  const actions = document.createElement("div");
  actions.className = "panel-actions";

  const ok = document.createElement("button");
  ok.className = "btn btn-ok";
  ok.textContent = "OK";
  ok.addEventListener("click", cb.onOk);

  const cancel = document.createElement("button");
  cancel.className = "btn btn-cancel";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", cb.onCancel);

  actions.appendChild(cancel);
  actions.appendChild(ok);
  host.appendChild(actions);

  return { setStatus: (s: string) => (status.textContent = s) };
}
