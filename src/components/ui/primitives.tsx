/** Compatibility barrel. Root/marketing routes use core to avoid pulling optional
 * dialog/query implementations into their critical static import graph. */
export * from './core';
export { Modal } from './modal';
export { useResource } from '../../lib/resource-query';
