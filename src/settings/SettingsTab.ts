import { App, PluginSettingTab, Setting } from "obsidian";
import type GraphProNextPlugin from "../main";

export class GraphProSettingsTab extends PluginSettingTab {
  plugin: GraphProNextPlugin;

  constructor(app: App, plugin: GraphProNextPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "GraphPro-Next 설정 (1·2·3홉 거리 및 레이아웃)" });

    new Setting(containerEl)
      .setName("1홉 반경 (Hop 1 Base Radius)")
      .setDesc("중심 페이지(0, 0)로부터 1홉(직접 연결된 페이지) 원까지의 기본 거리 (px)")
      .addSlider((slider) =>
        slider
          .setLimits(40, 700, 10)
          .setValue(this.plugin.settings.hop1Radius)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.hop1Radius = val;
            this.plugin.settings.defaultCircleRadius = val;
            await this.plugin.saveSettings();
            this.plugin.reapplyActiveLayout(true);
          })
      );

    new Setting(containerEl)
      .setName("2홉 추가 간격 (Hop 2 Ring Gap)")
      .setDesc("1홉 원에서 2홉 외곽 동심원까지의 반경 간격 (px)")
      .addSlider((slider) =>
        slider
          .setLimits(40, 700, 10)
          .setValue(this.plugin.settings.hop2Gap)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.hop2Gap = val;
            await this.plugin.saveSettings();
            this.plugin.reapplyActiveLayout(true);
          })
      );

    new Setting(containerEl)
      .setName("3홉 추가 간격 (Hop 3 Ring Gap)")
      .setDesc("2홉 원에서 3홉 최외곽 동심원까지의 반경 간격 (px)")
      .addSlider((slider) =>
        slider
          .setLimits(40, 700, 10)
          .setValue(this.plugin.settings.hop3Gap)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.hop3Gap = val;
            await this.plugin.saveSettings();
            this.plugin.reapplyActiveLayout(true);
          })
      );

    new Setting(containerEl)
      .setName("노드 수 비례 자동 반경 확장 (Auto-Expand Spacing per Node)")
      .setDesc("1홉 노드가 많을 때 겹침 방지를 위해 둘레를 넓히는 간격 (0으로 설정 시 노드 개수와 무관하게 1홉 반경 고정)")
      .addSlider((slider) =>
        slider
          .setLimits(0, 80, 2)
          .setValue(this.plugin.settings.nodeArcSpacing)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.nodeArcSpacing = val;
            await this.plugin.saveSettings();
            this.plugin.reapplyActiveLayout(true);
          })
      );

    new Setting(containerEl)
      .setName("그리드 스냅 크기 (Grid Size)")
      .setDesc("바둑판 격자 정렬 시 간격")
      .addSlider((slider) =>
        slider
          .setLimits(20, 100, 10)
          .setValue(this.plugin.settings.gridSize)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.gridSize = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("마키 영역 선택 활성화 (Shift + Drag)")
      .setDesc("그래프 창에서 Shift 키를 누르고 드래그하여 다중 노드를 한 번에 선택")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableMarqueeSelection)
          .onChange(async (val) => {
            this.plugin.settings.enableMarqueeSelection = val;
            await this.plugin.saveSettings();
          })
      );
  }
}
