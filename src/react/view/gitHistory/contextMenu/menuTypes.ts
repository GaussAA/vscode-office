import type { GitFileChange } from "../types";

export interface ContextMenuItem {
  id: string;
  label: string;
  emphasis?: string;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export interface MenuPayloadMeta {
  _hash?: string;
  _parents?: string[];
  _message?: string;
  _branch?: string;
  _remote?: string;
  _ref?: string;
  _tag?: string;
  _selector?: string;
  _change?: GitFileChange;
  _hasParents?: boolean;
  _path?: string;
}
