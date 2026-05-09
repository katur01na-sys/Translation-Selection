/**
 * R3: 核心数据结构类型定义 (JSDoc)
 * 为主要接口和数据模型提供类型注释
 *
 * 使用方式: 在需要类型提示的文件顶部添加
 *   /// <reference path="../types.js" />
 */

/**
 * @typedef {Object} Segment
 * @property {number} id - 句段 ID (主键)
 * @property {number} project_id - 所属项目 ID
 * @property {string} source - 源文
 * @property {string} [target] - 译文
 * @property {'pending'|'translated'|'in_review'|'done'|'error'} status - 状态
 * @property {'male'|'female'} [gender] - 说话人性别
 * @property {number} [score] - 审核评分 (0-100)
 * @property {ReviewError[]} [errors] - 审核错误
 * @property {Object} [dimensions] - 七维度评分
 * @property {string} [fixedTarget] - AI 修复后的译文
 * @property {boolean} [fixed] - 是否已应用修复
 */

/**
 * @typedef {Object} ReviewError
 * @property {string} type - 错误类型 (如 GRAMMAR, TERMINOLOGY)
 * @property {string} severity - 严重程度 (critical|major|minor)
 * @property {string} message - 错误描述
 * @property {string} [suggestion] - 修改建议
 */

/**
 * @typedef {Object} Project
 * @property {number} projectId - 项目 ID
 * @property {string} [project_name] - 项目名称
 * @property {string} file_path - 源文件路径
 * @property {Segment[]} segments - 句段列表
 * @property {string} [guidelineText] - 审核规范文本
 * @property {string} [globalContext] - 全局上下文
 * @property {boolean} success - 加载是否成功
 */

/**
 * @typedef {Object} GlossaryItem
 * @property {number} id - 术语 ID
 * @property {number} [project_id] - 所属项目 ID (null=全局)
 * @property {string} source_term - 源词 (英文/原文)
 * @property {string} target_term - 波兰语译词
 * @property {string} [chinese_meaning] - 中文含义
 * @property {string} [notes] - 备注说明
 */

/**
 * @typedef {Object} Settings
 * @property {string} apiKey - 加密的 API 密钥
 * @property {string} apiModel - AI 模型供应商 (deepseek|qwen|minimax)
 * @property {string} [modelName] - 具体模型名称
 * @property {string} sourceLang - 源语言
 * @property {string} [customPrompt] - 自定义 Prompt
 * @property {string} [globalContext] - 全局上下文
 */

/**
 * @typedef {Object} BgProgress
 * @property {number} done - 已完成数量
 * @property {number} total - 总数量
 * @property {string} [currentId] - 当前处理的句段 ID
 * @property {string} [error] - 最近错误信息
 * @property {boolean} running - 是否运行中
 * @property {boolean} paused - 是否暂停
 * @property {'idle'|'translate'|'review'} phase - 当前阶段
 * @property {string} [projectId] - 项目 ID
 * @property {Segment[]} [updatedSegments] - P2 增量更新数据
 */

export {}
