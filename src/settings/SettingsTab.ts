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

    containerEl.createEl("h2", { text: "GraphPro-Next 설정 (Layout & Performance)" });

    new Setting(containerEl)
      .setName("기본 원형 배치 반경 (Base Circle Radius)")
      .setDesc("원형 궤도 정렬 시 노드 간 기본 최소 반경 (픽셀 단위)")
      .addSlider((slider) =>
        slider
          .setLimits(100, 500, 20)
          .setValue(this.plugin.settings.defaultCircleRadius)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.defaultCircleRadius = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("그리드 스냅 크기 (Grid Size)")
      .setDesc("격자 정렬 시 한 칸의 픽셀 간격")
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

    new Setting(containerEl)
      .setName("실행 취소(Undo) 히스토리 최대 단계")
      .setDesc("메모리에 보관할 레이아웃 변경 단계 수 (기본: 30)")
      .addSlider((slider) =>
        slider
          .setLimits(10, 100, 5)
          .setValue(this.plugin.settings.historyMaxDepth)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.historyMaxDepth = val;
            await this.plugin.saveSettings();
          })
      );
  }
}
