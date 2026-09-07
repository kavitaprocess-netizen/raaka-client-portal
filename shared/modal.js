// shared/modal.js
//
// customConfirm/customAlert/customPrompt — a real, in-app modal system
// used throughout all three apps instead of native confirm()/alert()/
// prompt(), which don't match the app's styling and can't be awaited
// cleanly alongside async flows the way these Promise-based versions
// can.
//
// Depends on specific DOM elements already existing in the host page:
//   #custom-modal-overlay, #custom-modal-title, #custom-modal-body,
//   #custom-modal-actions, #custom-modal-input-wrap, #custom-modal-input
// All three apps already have this markup (added consistently when this
// was first built, then again here to make sure Client Portal — which
// only ever had customConfirm before this extraction — has the full set
// too, since a shared module needs the same DOM contract everywhere it
// loads).

export function customConfirm(title, body) {
  return new Promise(resolve => {
    const overlay = document.getElementById('custom-modal-overlay');
    document.getElementById('custom-modal-title').textContent = title;
    document.getElementById('custom-modal-body').textContent = body;
    document.getElementById('custom-modal-input-wrap').style.display = 'none';
    document.getElementById('custom-modal-actions').innerHTML = `
      <button class="btn btn-secondary btn-sm" id="custom-modal-cancel">Cancel</button>
      <button class="btn btn-primary btn-sm" id="custom-modal-ok">OK</button>`;
    overlay.classList.add('show');
    const cleanup = (result) => { overlay.classList.remove('show'); resolve(result); };
    document.getElementById('custom-modal-cancel').onclick = () => cleanup(false);
    document.getElementById('custom-modal-ok').onclick = () => cleanup(true);
  });
}

export function customAlert(title, body) {
  return new Promise(resolve => {
    const overlay = document.getElementById('custom-modal-overlay');
    document.getElementById('custom-modal-title').textContent = title;
    document.getElementById('custom-modal-body').textContent = body;
    document.getElementById('custom-modal-input-wrap').style.display = 'none';
    document.getElementById('custom-modal-actions').innerHTML = `<button class="btn btn-primary btn-sm" id="custom-modal-ok">OK</button>`;
    overlay.classList.add('show');
    document.getElementById('custom-modal-ok').onclick = () => { overlay.classList.remove('show'); resolve(); };
  });
}

// Returns the entered text on OK, or null on Cancel. When `required` is
// true, the OK button starts disabled and only enables once real text
// is entered — validated in the dialog itself, rather than letting
// someone close it empty and showing an error message afterward on the
// page behind it.
export function customPrompt(title, body, placeholder, required) {
  return new Promise(resolve => {
    const overlay = document.getElementById('custom-modal-overlay');
    document.getElementById('custom-modal-title').textContent = title;
    document.getElementById('custom-modal-body').textContent = body;
    const inputWrap = document.getElementById('custom-modal-input-wrap');
    const input = document.getElementById('custom-modal-input');
    inputWrap.style.display = 'block';
    input.value = '';
    input.placeholder = placeholder || '';
    document.getElementById('custom-modal-actions').innerHTML = `
      <button class="btn btn-secondary btn-sm" id="custom-modal-cancel">Cancel</button>
      <button class="btn btn-primary btn-sm" id="custom-modal-ok">OK</button>`;
    overlay.classList.add('show');
    input.focus();
    const okBtn = document.getElementById('custom-modal-ok');
    const updateOkState = () => { okBtn.disabled = !input.value.trim(); };
    if (required) {
      updateOkState();
      input.oninput = updateOkState;
    } else {
      input.oninput = null;
      okBtn.disabled = false;
    }
    const cleanup = (result) => { overlay.classList.remove('show'); input.oninput = null; resolve(result); };
    document.getElementById('custom-modal-cancel').onclick = () => cleanup(null);
    okBtn.onclick = () => { if (!okBtn.disabled) cleanup(input.value.trim()); };
  });
}
