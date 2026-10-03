import {inferSupplierType} from './supplierType';
test('company suffix and valid fiscal identifiers suggest the supplier type',()=>{
 expect(inferSupplierType('Transportes Ejemplo S.L.','')).toBe('empresa');
 expect(inferSupplierType('Transportes Ejemplo','B54496146')).toBe('empresa');
 expect(inferSupplierType('Persona','16868393D')).toBe('autonomo');
 expect(inferSupplierType('Transportes Ejemplo','B54496145')).toBe(null);
 expect(inferSupplierType('Manuel García','')).toBe(null);
});
