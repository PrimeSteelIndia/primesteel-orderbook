/* ------------------------------------------------------------------ */
/* the share sheet — save the file, then open that exact WhatsApp chat  */
/* ------------------------------------------------------------------ */

function openShareSheet(data) {
  const waText = waMessage(data);

  const body = `
    <div id="estPreview" style="display:flex;justify-content:center;margin-bottom:14px;min-height:120px">
      <div class="skel" style="width:100%;height:300px;border-radius:12px"></div>
    </div>

    <div class="card card-pad" style="margin-bottom:12px">
      <div class="row" style="justify-content:space-between;margin-bottom:10px">
        <span class="strong">Send as</span>
      </div>
      <div class="fbtns">
        <button class="fmt-btn active" data-fmt="pdf">
          <span class="fmt-title">PDF</span>
          <span class="fmt-sub">Best for printing and the office file</span>
        </button>
        <button class="fmt-btn" data-fmt="image">
          <span class="fmt-title">Image</span>
          <span class="fmt-sub">Opens straight in the chat</span>
        </button>
      </div>
      <div class="tiny" style="color:#64748b;margin-top:10px;line-height:1.45" id="fmtHint">
        A PDF keeps the layout exact and prints cleanly on any printer.
      </div>
    </div>

    <div class="field">
      <label for="waPhone">Customer WhatsApp number</label>
      <input class="input" id="waPhone" inputmode="tel" placeholder="10-digit mobile"
             value="${esc(data.customerPhone || '')}">
      <div class="tiny" style="color:#64748b;margin-top:6px" id="phoneHint">
        Filled from the customer. Change it here if it is wrong.
      </div>
    </div>

    <div style="margin-top:14px;display:flex;flex-direction:column;gap:9px">
      <button class="btn btn-success btn-lg btn-block" id="sendFileBtn">
        ${icon('whatsapp', 'i i-sm')} Send <span id="fmtWord">PDF</span> on WhatsApp
      </button>
      <button class="btn btn-block btn-soft" id="waTextBtn">
        ${icon('whatsapp', 'i i-sm')} Send text only
      </button>
      <div class="row" style="gap:9px">
        <button class="btn btn-soft" id="copyBtn" style="flex:1">Copy as text</button>
        <button class="btn btn-soft" id="saveBtn2" style="flex:1">Save file only</button>
      </div>
    </div>

    <div class="tiny" style="color:#94a3b8;margin-top:12px;line-height:1.45">
      The file is saved to your phone and the chat opens with the number filled —
      tap the paperclip once and pick the file. No browser can push a file into a
      WhatsApp chat for you; that one tap is a WhatsApp rule, not a missing feature.
    </div>
  `;

  const { sheet, close } = openSheet({
    title: 'Send this estimate',
    sub: data.customerName ? `${data.customerName} · ${money(data.totalAmount)}` : `Walk-in · ${money(data.totalAmount)}`,
    body,
    onMount: mount,
  });

  function mount(node) {
    let fmt = 'pdf';

    const { preview } = estPreviewCanvas(data, Math.min(520, node.clientWidth || 340));
    preview.style.width = '100%';
    preview.style.maxWidth = '520px';
    preview.style.height = 'auto';
    preview.style.borderRadius = '12px';
    preview.style.border = '1px solid #e3e8ee';
    preview.style.display = 'block';
    const holder = $('#estPreview', node);
    holder.innerHTML = '';
    holder.appendChild(preview);

    const fmtWord = $('#fmtWord', node);
    const hint = $('#fmtHint', node);
    const phoneInput = $('#waPhone', node);

    $$('[data-fmt]', node).forEach(btn => {
      btn.addEventListener('click', () => {
        fmt = btn.dataset.fmt;
        $$('[data-fmt]', node).forEach(b => b.classList.toggle('active', b === btn));
        fmtWord.textContent = fmt === 'pdf' ? 'PDF' : 'image';
        hint.textContent = fmt === 'pdf'
          ? 'A PDF keeps the layout exact and prints cleanly on any printer.'
          : 'An image shows inside the chat without the customer tapping anything.';
      });
    });

    // ---- the one button most people should ever need -------------------
    $('#sendFileBtn', node).addEventListener('click', async () => {
      const btn = $('#sendFileBtn', node);
      const label = btn.innerHTML;
      btn.disabled = true;
      btn.textContent = 'Preparing...';
      try {
        const built = fmt === 'pdf' ? await buildEstimatePdf(data) : await buildEstimateImage(data);

        // 1. Always land the file on the phone first. This is what makes the
        //    PDF actually reachable from WhatsApp's paperclip.
        downloadBlob(built.blob, built.name);
        await new Promise(r => setTimeout(r, 400));

        // 2. Open the exact chat, number filled, with the summary as text.
        const num = waNumber(phoneInput.value);
        const href = num
          ? `https://wa.me/${num}?text=${encodeURIComponent(waText)}`
          : `https://wa.me/?text=${encodeURIComponent(waText)}`;
        window.open(href, '_blank');

        toast(`${built.name} saved — attach it in the chat`, 'success', 6000);
      } catch (err) {
        toast(err.message || 'Could not build the file', 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = label;
      }
    });

    $('#waTextBtn', node).addEventListener('click', () => {
      const num = waNumber(phoneInput.value);
      const href = num
        ? `https://wa.me/${num}?text=${encodeURIComponent(waText)}`
        : `https://wa.me/?text=${encodeURIComponent(waText)}`;
      window.open(href, '_blank');
    });

    $('#copyBtn', node).addEventListener('click', async () => {
      const ok = await copyText(waText);
      toast(ok ? 'Estimate copied' : 'Could not copy', ok ? 'success' : 'error');
    });

    $('#saveBtn2', node).addEventListener('click', async () => {
      try {
        const built = fmt === 'pdf' ? await buildEstimatePdf(data) : await buildEstimateImage(data);
        downloadBlob(built.blob, built.name);
        toast(`Saved ${built.name}`, 'success');
      } catch (err) {
        toast(err.message || 'Could not build the file', 'error');
      }
    });

    // Remember a hand-typed number so the next estimate fills itself.
    phoneInput.addEventListener('change', () => {
      const v = phoneInput.value.trim();
      if (v && data.customerName) {
        api('/api/customers/quickphone', {
          method: 'POST',
          body: { name: data.customerName, phone: v },
        }).catch(() => {});
      }
    });
  }
}