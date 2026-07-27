import type { App } from 'obsidian';
import { PluginSettingTab, Setting } from 'obsidian';
import type MermaidZoomPlugin from './main';

export interface MermaidZoomSettings {
	defaultZoom: number; // percentage, e.g. 100 means 100%
	showContainerBorder: boolean;
	alignment: 'left' | 'center' | 'right';
	maxHeight: number; // pixels, 0 = auto (fit content at current zoom)
}

export const DEFAULT_SETTINGS: MermaidZoomSettings = {
	defaultZoom: 100,
	showContainerBorder: false,
	alignment: 'center',
	maxHeight: 0,
};

export class MermaidZoomSettingTab extends PluginSettingTab {
	plugin: MermaidZoomPlugin;

	constructor(app: App, plugin: MermaidZoomPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Default zoom level')
			.setDesc('Initial zoom percentage when a Mermaid diagram is rendered. 100% fits the container; higher values make diagrams appear larger by default.')
			.addSlider(slider => slider
				.setLimits(50, 300, 5)
				.setValue(this.plugin.settings.defaultZoom)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.defaultZoom = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Show container border')
			.setDesc('Display a dashed border around each diagram container to help visualize the zoom area boundaries.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showContainerBorder)
				.onChange(async (value) => {
					this.plugin.settings.showContainerBorder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Default alignment')
			.setDesc('Horizontal alignment of the diagram within its container.')
			.addDropdown(dropdown => dropdown
				.addOption('left', 'Left')
				.addOption('center', 'Center')
				.addOption('right', 'Right')
				.setValue(this.plugin.settings.alignment)
				.onChange(async (value) => {
					this.plugin.settings.alignment = value as 'left' | 'center' | 'right';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Max container height')
			.setDesc('Maximum height in pixels for the zoom container. Set to 0 to auto-size so the diagram is fully visible at the current zoom level.')
			.addText(text => text
				.setPlaceholder('0')
				.setValue(this.plugin.settings.maxHeight > 0 ? String(this.plugin.settings.maxHeight) : '')
				.onChange(async (value) => {
					const num = parseInt(value, 10);
					this.plugin.settings.maxHeight = isNaN(num) || num < 0 ? 0 : num;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('p', {
			text: 'Changes apply to newly rendered diagrams. Reload the note to see the effect on existing diagrams.',
			cls: 'setting-item-description'
		});
	}
}
