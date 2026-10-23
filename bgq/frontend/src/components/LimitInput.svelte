<script>
  let { id, label, max, width, defaultValue, value = $bindable() } = $props();

  function handleInput(event) {
    const input = event.currentTarget;
    if (input.validity.badInput) {
      input.value = String(value);
      return;
    }
    if (!input.value) return;
    if (!/^\d+$/.test(input.value)) {
      input.value = String(value);
      return;
    }
    const number = Math.min(max, Math.max(1, Number(input.value)));
    input.value = String(number);
    value = number;
  }

  function handleBlur(event) {
    if (!event.currentTarget.value) {
      value = defaultValue;
      event.currentTarget.value = String(defaultValue);
    }
  }
</script>

<div>
  <label class="form-label" for={id}>{label}</label>
  <input
    class="input"
    {id}
    type="number"
    min="1"
    {max}
    step="1"
    inputmode="numeric"
    autocomplete="off"
    {value}
    oninput={handleInput}
    onblur={handleBlur}
    style:width={`${width}px`}
  />
</div>
