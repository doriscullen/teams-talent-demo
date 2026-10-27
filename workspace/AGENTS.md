

<!-- Talents: a-traj/change-01 -->
- 运行验证脚本时，不要用管道（如 `| tail`）截断输出；单独记录脚本退出码，并核对输出中的业务字段（如对账 matched、mismatch）。脚本执行完成不等于业务结果正确。
