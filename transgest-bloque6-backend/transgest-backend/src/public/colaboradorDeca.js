(() => {
  const form=document.querySelector('[data-deca-decision]');
  if(!form)return;
  const fields=form.querySelector('[data-cargo-fields]');
  const toggle=()=>{
    const required=form.querySelector('input[name="deca_origen"]:checked')?.value==='solicitar';
    fields.hidden=!required;fields.disabled=!required;
  };
  form.addEventListener('change',toggle);
  toggle();
  form.addEventListener('submit',event=>{
    if(!fields.disabled&&!window.confirm('Antes de emitir el DeCA, contrasta con el chófer la mercancía, los bultos, el peso y la carga de origen de cada envío. ¿Has verificado estos datos?'))event.preventDefault();
  });
})();
