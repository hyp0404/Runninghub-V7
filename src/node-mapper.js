const ROLE_SPECS = {
  character_image: {
    types: ["IMAGE"],
    keywords: ["角色参考", "人物参考", "参考人物", "人物图片", "角色图片", "reference image", "character image", "subject image", "上传图片"]
  },
  motion_video: {
    types: ["VIDEO"],
    keywords: ["动作参考", "参考视频", "动作视频", "驱动视频", "motion video", "reference video", "driving video", "上传视频"]
  },
  prompt: {
    types: ["STRING"],
    keywords: ["提示词", "正向提示", "prompt", "描述"]
  },
  width: {
    types: ["INT", "INTEGER", "FLOAT", "STRING", "LIST"],
    keywords: ["宽度", "输出宽", "width"]
  },
  height: {
    types: ["INT", "INTEGER", "FLOAT", "STRING", "LIST"],
    keywords: ["高度", "输出高", "height"]
  },
  fps: {
    types: ["INT", "INTEGER", "FLOAT", "STRING", "LIST"],
    keywords: ["帧率", "fps", "frame rate"]
  },
  pose_strength: {
    types: ["INT", "INTEGER", "FLOAT", "STRING", "LIST"],
    keywords: ["姿态强度", "姿势强度", "pose strength", "动作强度"]
  },
  pose_method: {
    types: ["STRING", "LIST"],
    keywords: ["姿势计算", "姿态算法", "pose method", "vitpose", "sdpose", "scailpos"]
  },
  camera_motion: {
    types: ["BOOLEAN", "STRING", "LIST", "INT", "INTEGER"],
    keywords: ["运镜", "镜头运动", "camera motion", "camera"]
  }
};

const REQUIRED_ROLES = ["character_image", "motion_video"];

function textOf(node) {
  return [node.nodeName, node.fieldName, node.description, node.descriptionEn]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function normalizedType(node) {
  return String(node.fieldType || "").toUpperCase();
}

function scoreNode(node, spec) {
  const type = normalizedType(node);
  const text = textOf(node);
  let score = 0;
  if (spec.types.includes(type)) score += 8;
  for (const keyword of spec.keywords) {
    if (text.includes(keyword.toLowerCase())) score += keyword.length >= 4 ? 4 : 2;
  }
  return score;
}

function exactNode(nodes, target) {
  if (!target?.nodeId || !target?.fieldName) return null;
  const nodeId = String(target.nodeId);
  if (/替换|可选|replace/i.test(nodeId)) return null;
  return nodes.find((node) => String(node.nodeId) === nodeId && String(node.fieldName) === String(target.fieldName)) || null;
}

function automaticNode(nodes, role) {
  const spec = ROLE_SPECS[role];
  const scored = nodes
    .map((node) => ({ node, score: scoreNode(node, spec) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { node: null, candidates: [] };
  const best = scored[0];
  const tie = scored[1] && scored[1].score === best.score;

  if (!tie && best.score >= 10) return { node: best.node, candidates: scored.slice(0, 5) };

  // 仅对两个必需的媒体输入使用“唯一类型”兜底。数值/字符串节点太多，
  // 只按类型猜测会把 FPS 同时误认成宽、高、强度等多个角色。
  const typed = nodes.filter((node) => spec.types.includes(normalizedType(node)));
  if (REQUIRED_ROLES.includes(role) && !tie && typed.length === 1 && typed[0] === best.node) {
    return { node: best.node, candidates: scored.slice(0, 5) };
  }
  return { node: null, candidates: scored.slice(0, 5) };
}

export function resolveNodeMap(nodes, explicitMap = {}) {
  const mappings = {};
  const candidates = {};
  const warnings = [];

  for (const role of Object.keys(ROLE_SPECS)) {
    const explicit = exactNode(nodes, explicitMap[role]);
    if (explicit) {
      mappings[role] = { nodeId: String(explicit.nodeId), fieldName: String(explicit.fieldName), source: "explicit" };
      continue;
    }
    const automatic = automaticNode(nodes, role);
    candidates[role] = automatic.candidates.map(({ node, score }) => ({
      nodeId: String(node.nodeId),
      fieldName: String(node.fieldName),
      fieldType: node.fieldType,
      description: node.description,
      score
    }));
    if (automatic.node) {
      mappings[role] = { nodeId: String(automatic.node.nodeId), fieldName: String(automatic.node.fieldName), source: "automatic" };
    }
  }

  for (const role of REQUIRED_ROLES) {
    if (!mappings[role]) warnings.push(`无法唯一确定必需节点 ${role}，请设置WAN_NODE_MAP_JSON或WAN_NODE_MAP_FILE。`);
  }

  return { mappings, candidates, warnings, valid: REQUIRED_ROLES.every((role) => Boolean(mappings[role])) };
}

function key(nodeId, fieldName) {
  return `${String(nodeId)}::${String(fieldName)}`;
}

export function applyRoleValues(nodes, mappings, roleValues) {
  const byKey = new Map(Object.entries(mappings).map(([role, item]) => [key(item.nodeId, item.fieldName), role]));
  return nodes.map((node) => {
    const role = byKey.get(key(node.nodeId, node.fieldName));
    if (!role || roleValues[role] === undefined || roleValues[role] === null || roleValues[role] === "") return { ...node };
    return { ...node, fieldValue: String(roleValues[role]) };
  });
}

export function applyRawOverrides(nodes, overrides = []) {
  const overrideMap = new Map(overrides.map((item) => [key(item.nodeId, item.fieldName), item.fieldValue]));
  return nodes.map((node) => {
    const override = overrideMap.get(key(node.nodeId, node.fieldName));
    return override === undefined ? node : { ...node, fieldValue: String(override) };
  });
}

export function publicNode(node) {
  return {
    nodeId: String(node.nodeId),
    nodeName: node.nodeName,
    fieldName: node.fieldName,
    fieldType: node.fieldType,
    description: node.description,
    descriptionEn: node.descriptionEn,
    fieldData: node.fieldData
  };
}
