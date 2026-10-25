/**
 * Core Property Panel Infrastructure
 * 
 * Core components that make up the property panel system:
 * - PropertiesPanel: Main container
 * - PropertyPanelHeader: Tab navigation
 * - PropertyPanelBody: Content router
 * - PropertyPanelCollapsed: Collapsed state view
 * - EmptyPropertiesState: No selection state
 */

export { PropertiesPanel } from "./PropertiesPanel";
export type { PropertiesPanelProps } from "./PropertiesPanel";

export { default as PropertyPanelHeader } from "./PropertyPanelHeader";
export { default as PropertyPanelBody } from "./PropertyPanelBody";
export { default as PropertyPanelCollapsed } from "./PropertyPanelCollapsed";
export { EmptyPropertiesState } from "./EmptyPropertiesState";
