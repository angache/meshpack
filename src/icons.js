/**
 * Lucide ikonları — vanilla JS (lucide-react değil).
 * @see https://lucide.dev
 */
import { createElement, createIcons } from "lucide";
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleCheck,
  ClipboardList,
  Eye,
  EyeOff,
  FolderOpen,
  History,
  Maximize2,
  MessageCircle,
  Layers,
  Plus,
  ScanLine,
  Search,
  Send,
  Settings,
  Upload,
  Users,
  X,
} from "lucide";

const ICON_COMPONENTS = {
  "arrow-up": ArrowUp,
  "arrow-down": ArrowDown,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  circle: Circle,
  "circle-check": CircleCheck,
  "clipboard-list": ClipboardList,
  eye: Eye,
  "eye-off": EyeOff,
  "folder-open": FolderOpen,
  history: History,
  "maximize-2": Maximize2,
  "message-circle": MessageCircle,
  layers: Layers,
  plus: Plus,
  "scan-line": ScanLine,
  search: Search,
  send: Send,
  settings: Settings,
  upload: Upload,
  users: Users,
  x: X,
};

const SIZE_PX = { xs: 12, sm: 14, md: 16, lg: 20, xl: 24 };

/** Dinamik şablonlar için: initIcons() sonrası SVG'ye dönüşür */
export function iconInline(name, size = "sm", className = "") {
  const sizeClass = typeof size === "string" && SIZE_PX[size] ? `mp-icon-${size}` : "";
  const extra = className ? ` ${className}` : "";
  return `<i data-lucide="${name}" class="mp-icon ${sizeClass}${extra}" aria-hidden="true"></i>`;
}

/** Anında SVG string (initIcons gerekmez) */
export function iconHtml(name, { size = 16, className = "mp-icon", strokeWidth = 2 } = {}) {
  const Icon = ICON_COMPONENTS[name];
  if (!Icon) {
    console.warn(`[icons] Bilinmeyen ikon: ${name}`);
    return "";
  }
  const el = createElement(Icon, {
    width: size,
    height: size,
    class: className,
    "stroke-width": strokeWidth,
    "aria-hidden": "true",
  });
  return el.outerHTML;
}

/** data-lucide öğelerini SVG'ye çevirir */
export function initIcons(root = document) {
  const element = root instanceof Element ? root : document;
  createIcons({
    icons: ICON_COMPONENTS,
    nameAttr: "data-lucide",
    attrs: {
      class: "mp-icon",
      "stroke-width": 2,
      "aria-hidden": "true",
    },
    root: element,
  });
}
