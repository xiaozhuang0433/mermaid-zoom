import type { App, SettingDefinitionItem } from 'obsidian';
import { PluginSettingTab, Setting } from 'obsidian';
import type MermaidZoomPlugin from './main';
import { t } from './i18n';
import type { ExportDestination } from './export';

export interface MermaidZoomSettings {
	defaultZoom: number; // percentage, e.g. 100 means 100%
	zoomSensitivity: number; // multiplier on wheel/pinch zoom strength, 1 = default
	showContainerBorder: boolean;
	alignment: 'left' | 'center' | 'right';
	maxHeight: number; // pixels, 0 = auto (fit content at current zoom)
	exportDestination: ExportDestination; // 'vault' | 'download'
}

export const DEFAULT_SETTINGS: MermaidZoomSettings = {
	defaultZoom: 100,
	zoomSensitivity: 1,
	showContainerBorder: false,
	alignment: 'center',
	maxHeight: 0,
	exportDestination: 'vault',
};

export class MermaidZoomSettingTab extends PluginSettingTab {
	plugin: MermaidZoomPlugin;

	constructor(app: App, plugin: MermaidZoomPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Declarative settings API (Obsidian 1.13.0+). When this returns a
	// non-empty array, Obsidian renders the tab from these definitions and
	// indexes them for settings search; display() is used as the fallback for
	// older Obsidian versions.
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: t('setting.defaultZoom.name'),
				desc: t('setting.defaultZoom.desc'),
				control: {
					type: 'slider',
					key: 'defaultZoom',
					min: 50,
					max: 300,
					step: 5,
					defaultValue: 100,
					displayFormat: (value) => `${value}%`,
				},
			},
			{
				name: t('setting.zoomSensitivity.name'),
				desc: t('setting.zoomSensitivity.desc'),
				control: {
					type: 'slider',
					key: 'zoomSensitivity',
					min: 0.2,
					max: 3,
					step: 0.1,
					defaultValue: 1,
					displayFormat: (value) => `${value}x`,
				},
			},
			{
				name: t('setting.containerBorder.name'),
				desc: t('setting.containerBorder.desc'),
				control: {
					type: 'toggle',
					key: 'showContainerBorder',
					defaultValue: false,
				},
			},
			{
				name: t('setting.alignment.name'),
				desc: t('setting.alignment.desc'),
				control: {
					type: 'dropdown',
					key: 'alignment',
					options: {
						left: t('setting.alignment.option.left'),
						center: t('setting.alignment.option.center'),
						right: t('setting.alignment.option.right'),
					},
					defaultValue: 'center',
				},
			},
			{
				name: t('setting.maxHeight.name'),
				desc: t('setting.maxHeight.desc'),
				control: {
					type: 'number',
					key: 'maxHeight',
					defaultValue: 0,
					placeholder: '0',
					min: 0,
					step: 1,
				},
			},
			{
				name: t('setting.exportDestination.name'),
				desc: t('setting.exportDestination.desc'),
				control: {
					type: 'dropdown',
					key: 'exportDestination',
					options: {
						vault: t('setting.exportDestination.option.vault'),
						download: t('setting.exportDestination.option.download'),
					},
					defaultValue: 'vault',
				},
			},
		];
	}

	// Persist declarative-control writes through the plugin's own saver so
	// data.json stays in sync. (The base reads from this.plugin.settings.)
	async setControlValue(key: string, value: unknown): Promise<void> {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		await this.plugin.saveSettings();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(t('setting.defaultZoom.name'))
			.setDesc(t('setting.defaultZoom.desc'))
			.addSlider(slider => slider
				.setLimits(50, 300, 5)
				.setValue(this.plugin.settings.defaultZoom)
				.onChange(async (value) => {
					this.plugin.settings.defaultZoom = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('setting.zoomSensitivity.name'))
			.setDesc(t('setting.zoomSensitivity.desc'))
			.addSlider(slider => slider
				.setLimits(0.2, 3, 0.1)
				.setValue(this.plugin.settings.zoomSensitivity)
				.onChange(async (value) => {
					this.plugin.settings.zoomSensitivity = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('setting.containerBorder.name'))
			.setDesc(t('setting.containerBorder.desc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showContainerBorder)
				.onChange(async (value) => {
					this.plugin.settings.showContainerBorder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('setting.alignment.name'))
			.setDesc(t('setting.alignment.desc'))
			.addDropdown(dropdown => dropdown
				.addOption('left', t('setting.alignment.option.left'))
				.addOption('center', t('setting.alignment.option.center'))
				.addOption('right', t('setting.alignment.option.right'))
				.setValue(this.plugin.settings.alignment)
				.onChange(async (value) => {
					this.plugin.settings.alignment = value as 'left' | 'center' | 'right';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('setting.maxHeight.name'))
			.setDesc(t('setting.maxHeight.desc'))
			.addText(text => text
				.setPlaceholder('0')
				.setValue(this.plugin.settings.maxHeight > 0 ? String(this.plugin.settings.maxHeight) : '')
				.onChange(async (value) => {
					const num = parseInt(value, 10);
					this.plugin.settings.maxHeight = isNaN(num) || num < 0 ? 0 : num;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('setting.exportDestination.name'))
			.setDesc(t('setting.exportDestination.desc'))
			.addDropdown(dropdown => dropdown
				.addOption('vault', t('setting.exportDestination.option.vault'))
				.addOption('download', t('setting.exportDestination.option.download'))
				.setValue(this.plugin.settings.exportDestination)
				.onChange(async (value) => {
					this.plugin.settings.exportDestination = value as ExportDestination;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('p', {
			text: t('settings.note'),
			cls: 'setting-item-description'
		});
	}
}
