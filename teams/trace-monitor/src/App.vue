<script setup lang="ts">
// 内嵌版外壳：去掉原顶栏/侧栏，也不再重复一条标题条。
// 项目选择 / 存储模式 / 刷新 已并入列表页工具条，详情页保留「返回列表」。
import { onMounted } from "vue";
import { useProjectStore } from "@/stores/project";
import { useAppConfigStore } from "@/stores/appConfig";

const projectStore = useProjectStore();
const appConfigStore = useAppConfigStore();

onMounted(() => {
  projectStore.load();
  appConfigStore.load();
  // 无历史项目时回落到 iCode 实时采集项目
  if (!projectStore.selected) projectStore.applySelection("icode");
});
</script>

<template>
  <div class="tm-app tm-embed">
    <main class="tm-embed-content">
      <router-view />
    </main>
  </div>
</template>

<style scoped lang="scss">
.tm-embed {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-height: 0;
  background: var(--bg-canvas);
}
.tm-embed-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 24px 24px;
}
@media (max-width: 600px) {
  .tm-embed-content {
    padding: 12px;
  }
}
</style>
