// ============================================================
// 电缆载流量计算器 — 基于 GB/T 16895.15 / IEC 60364-5-52
// ============================================================

// ---- 基准载流量表 (PVC绝缘, 30°C, 空气中敷设) ----
// 单位: A, 三根导体, 截面积 mm²

const BASE_AMPACITY = {
  copper: {
    pvc:  { '1.5':18, '2.5':25, '4':32, '6':40, '10':55, '16':70, '25':95, '35':115, '50':145, '70':180, '95':220, '120':255, '150':295, '185':340, '240':400, '300':460, '400':540, '500':620, '630':710 },
    xlpe: { '1.5':24, '2.5':33, '4':43, '6':54, '10':73, '16':95, '25':125, '35':155, '50':195, '70':240, '95':290, '120':335, '150':385, '185':440, '240':520, '300':595, '400':700, '500':800, '630':920 }
  },
  aluminum: {
    pvc:  { '1.5':14, '2.5':19, '4':25, '6':31, '10':42, '16':55, '25':75, '35':90, '50':110, '70':140, '95':170, '120':200, '150':230, '185':265, '240':310, '300':360, '400':420, '500':485, '630':555 },
    xlpe: { '1.5':19, '2.5':26, '4':33, '6':42, '10':56, '16':73, '25':97, '35':120, '50':150, '70':185, '95':225, '120':260, '150':300, '185':340, '240':405, '300':465, '400':545, '500':625, '630':715 }
  }
};

// ---- 温度修正系数 ----
// PVC: 基准30°C, 最高70°C
// XLPE: 基准30°C, 最高90°C

function getTemperatureFactor(ambientTemp, insulation) {
  const t = parseFloat(ambientTemp);
  if (isNaN(t)) return 1;

  if (insulation === 'pvc') {
    // PVC绝缘: 基准30°C, 最高导体温度70°C
    if (t <= 10) return 1.22;
    if (t <= 15) return 1.17;
    if (t <= 20) return 1.12;
    if (t <= 25) return 1.06;
    if (t <= 30) return 1.00;
    if (t <= 35) return 0.94;
    if (t <= 40) return 0.87;
    if (t <= 45) return 0.79;
    if (t <= 50) return 0.71;
    if (t <= 55) return 0.61;
    if (t <= 60) return 0.50;
    return 0;
  } else {
    // XLPE绝缘: 基准30°C, 最高导体温度90°C
    if (t <= 10) return 1.15;
    if (t <= 15) return 1.12;
    if (t <= 20) return 1.08;
    if (t <= 25) return 1.04;
    if (t <= 30) return 1.00;
    if (t <= 35) return 0.96;
    if (t <= 40) return 0.91;
    if (t <= 45) return 0.87;
    if (t <= 50) return 0.82;
    if (t <= 55) return 0.76;
    if (t <= 60) return 0.71;
    if (t <= 65) return 0.65;
    if (t <= 70) return 0.58;
    if (t <= 75) return 0.50;
    return 0;
  }
}

// ---- 敷设方式修正系数 ----
function getInstallFactor(method) {
  switch (method) {
    case 'air':     return 1.00; // 空气中 (基准)
    case 'conduit': return 0.80; // 穿管
    case 'buried':  return 0.85; // 埋地 (一般土壤)
    default: return 1;
  }
}

// ---- 并列回路修正系数 ----
function getGroupFactor(count) {
  const n = parseInt(count);
  if (n <= 1) return 1.00;
  if (n === 2) return 0.80;
  if (n === 3) return 0.70;
  if (n === 4) return 0.65;
  if (n <= 6) return 0.60;
  if (n <= 9) return 0.50;
  return 0.45; // 10+
}

// ---- 计算电阻 (用于电压降) ----
// 单位: Ω/km, 20°C 直流电阻近似值
function getResistance(material, crossSection) {
  const s = parseFloat(crossSection);
  const rho = material === 'copper' ? 0.0175 : 0.0283; // Ω·mm²/m
  return rho / s; // Ω/m
}

// ---- 计算电压降 ----
function calcVoltageDrop(material, crossSection, length, current, voltage) {
  const R = getResistance(material, crossSection); // Ω/m
  const L = parseFloat(length);
  const I = parseFloat(current);
  const V = parseFloat(voltage);

  if (isNaN(L) || isNaN(I) || L <= 0 || I <= 0) return null;

  // 三相: ΔU = √3 × I × R × L
  // 单相: ΔU = 2 × I × R × L
  let deltaV;
  if (voltage >= 380) {
    deltaV = Math.sqrt(3) * I * R * L;
  } else {
    deltaV = 2 * I * R * L;
  }

  const percent = (deltaV / V) * 100;
  return { volts: deltaV, percent: percent };
}

// ============================================================
// DOM 引用
// ============================================================
const els = {
  materialBtns: document.querySelectorAll('#materialGroup .toggle-btn'),
  crossSection: document.getElementById('crossSection'),
  installMethod: document.getElementById('installMethod'),
  insulation: document.getElementById('insulation'),
  ambientTemp: document.getElementById('ambientTemp'),
  parallelCircuits: document.getElementById('parallelCircuits'),
  cableLength: document.getElementById('cableLength'),
  systemVoltage: document.getElementById('systemVoltage'),
  loadCurrent: document.getElementById('loadCurrent'),
  // 显示
  correctedAmpacity: document.getElementById('correctedAmpacity'),
  powerNote: document.getElementById('powerNote'),
  baseAmpacity: document.getElementById('baseAmpacity'),
  tempFactor: document.getElementById('tempFactor'),
  groupFactor: document.getElementById('groupFactor'),
  installFactor: document.getElementById('installFactor'),
  totalFactor: document.getElementById('totalFactor'),
  voltageDrop: document.getElementById('voltageDrop'),
  refTableBody: document.querySelector('#refTable tbody'),
};

// ============================================================
// 状态
// ============================================================
let state = {
  material: 'copper',
  crossSection: '10',
  installMethod: 'air',
  insulation: 'pvc',
  ambientTemp: 30,
  parallelCircuits: 1,
  cableLength: '',
  systemVoltage: '380',
  loadCurrent: '',
};

// ============================================================
// 事件绑定
// ============================================================
els.materialBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    els.materialBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.material = btn.dataset.value;
    recalc();
  });
});

els.crossSection.addEventListener('change', () => {
  state.crossSection = els.crossSection.value;
  recalc();
});

els.installMethod.addEventListener('change', () => {
  state.installMethod = els.installMethod.value;
  recalc();
});

els.insulation.addEventListener('change', () => {
  state.insulation = els.insulation.value;
  recalc();
});

els.ambientTemp.addEventListener('input', () => {
  state.ambientTemp = els.ambientTemp.value;
  recalc();
});

els.parallelCircuits.addEventListener('change', () => {
  state.parallelCircuits = els.parallelCircuits.value;
  recalc();
});

// 电压降输入
[els.cableLength, els.loadCurrent].forEach(el => {
  el.addEventListener('input', () => {
    state.cableLength = els.cableLength.value;
    state.loadCurrent = els.loadCurrent.value;
    updateVoltageDrop();
  });
});

els.systemVoltage.addEventListener('change', () => {
  state.systemVoltage = els.systemVoltage.value;
  updateVoltageDrop();
});

// ============================================================
// 核心计算
// ============================================================
function recalc() {
  const { material, crossSection, installMethod, insulation, ambientTemp, parallelCircuits } = state;

  // 1) 查基准值
  const base = BASE_AMPACITY[material]?.[insulation]?.[crossSection];
  if (base === undefined) {
    els.correctedAmpacity.textContent = '-- A';
    els.baseAmpacity.textContent = '-- A';
    return;
  }

  // 2) 各项修正系数
  const kTemp = getTemperatureFactor(ambientTemp, insulation);
  const kGroup = getGroupFactor(parallelCircuits);
  const kInstall = getInstallFactor(installMethod);
  const kTotal = kTemp * kGroup * kInstall;

  // 3) 修正后载流量
  const corrected = Math.round(base * kTotal);

  // 4) 更新 UI
  els.baseAmpacity.textContent = base + ' A';
  els.correctedAmpacity.textContent = corrected + ' A';
  els.tempFactor.textContent = kTemp.toFixed(2);
  els.groupFactor.textContent = kGroup.toFixed(2);
  els.installFactor.textContent = kInstall.toFixed(2);
  els.totalFactor.textContent = kTotal.toFixed(2);

  // 功率估算 (380V三相)
  const power = Math.round(corrected * 380 * Math.sqrt(3) / 1000);
  els.powerNote.textContent = '≈ ' + power + ' kW (380V 三相)';

  // 警告颜色
  if (kTotal < 0.5) {
    els.correctedAmpacity.style.color = '#e05555';
  } else if (kTotal < 0.7) {
    els.correctedAmpacity.style.color = '#e0a055';
  } else {
    els.correctedAmpacity.style.color = '#4a90d9';
  }

  updateVoltageDrop();
  updateRefTable();
}

function updateVoltageDrop() {
  const { material, crossSection } = state;
  const length = els.cableLength.value;
  const current = els.loadCurrent.value;
  const voltage = els.systemVoltage.value;

  if (!length || !current) {
    els.voltageDrop.textContent = '输入长度和电流后计算';
    return;
  }

  const result = calcVoltageDrop(material, crossSection, length, current, parseFloat(voltage));
  if (!result) {
    els.voltageDrop.textContent = '请输入有效值';
    return;
  }

  const vText = result.volts >= 10
    ? result.volts.toFixed(1)
    : result.volts.toFixed(2);

  els.voltageDrop.textContent = vText + ' V / ' + result.percent.toFixed(2) + '%';

  if (result.percent > 5) {
    els.voltageDrop.style.color = '#e05555';
  } else if (result.percent > 3) {
    els.voltageDrop.style.color = '#e0a055';
  } else {
    els.voltageDrop.style.color = '#4a90d9';
  }
}

// ============================================================
// 速查表渲染
// ============================================================
function updateRefTable() {
  const { material, insulation, crossSection } = state;
  const data = BASE_AMPACITY[material][insulation];
  const sections = Object.keys(data);

  els.refTableBody.innerHTML = sections.map(s => {
    const cuVal = BASE_AMPACITY.copper[insulation][s];
    const alVal = BASE_AMPACITY.aluminum[insulation][s];
    const highlight = (s === crossSection) ? ' class="highlight"' : '';
    return `<tr${highlight}>
      <td>${s}</td>
      <td>${cuVal}</td>
      <td>${alVal}</td>
    </tr>`;
  }).join('');
}

// ============================================================
// 初始化
// ============================================================
recalc();
