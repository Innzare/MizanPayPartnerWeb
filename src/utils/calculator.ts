import type {
  AdvancedCalculatorInputs,
  BasicCalculatorInputs,
  CalculatorResult,
  PortfolioCalculatorInputs,
  PortfolioCalculatorResult,
  ReverseCalculatorInputs,
  ReverseCalculatorResult,
} from '@/types'

export function calculateBasic(inputs: BasicCalculatorInputs): CalculatorResult {
  const { purchasePrice, markupType, markupValue, termMonths, downPayment, paymentType } = inputs;

  const markup = markupType === 'percent' ? (purchasePrice * markupValue) / 100 : markupValue;
  const markupPercent = markupType === 'percent' ? markupValue : (markupValue / purchasePrice) * 100;
  const totalPrice = purchasePrice + markup;
  const profit = markup;
  const remainingAmount = totalPrice - downPayment;
  const roi = purchasePrice > 0 ? (profit / purchasePrice) * 100 : 0;

  let monthlyPayment: number;
  if (paymentType === 'equal') {
    monthlyPayment = termMonths > 0 ? remainingAmount / termMonths : 0;
  } else {
    monthlyPayment = termMonths > 0 ? remainingAmount / termMonths : 0;
  }

  return {
    totalPrice,
    markup,
    markupPercent,
    profit,
    monthlyPayment,
    roi,
  };
}

export function calculateAdvanced(inputs: AdvancedCalculatorInputs): CalculatorResult {
  const basic = calculateBasic(inputs);
  const { purchasePrice, platformCommission, transferFee, riskPercent, inflationPercent, cac, termMonths } = inputs;

  const platformCost = (basic.totalPrice * platformCommission) / 100;
  const transferCost = (basic.totalPrice * transferFee) / 100;
  const riskCost = (basic.profit * riskPercent) / 100;
  const netProfit = basic.profit - platformCost - transferCost - riskCost - cac;
  const netYield = purchasePrice > 0 ? (netProfit / purchasePrice) * 100 : 0;
  const effectiveAnnualYield = termMonths > 0 ? (netYield / termMonths) * 12 : 0;

  const breakEvenMarkup = platformCost + transferCost + cac;
  const breakEvenPoint = purchasePrice > 0 ? (breakEvenMarkup / purchasePrice) * 100 : 0;

  const riskAdjustedProfit = netProfit * (1 - riskPercent / 100);

  return {
    ...basic,
    netProfit,
    netYield,
    effectiveAnnualYield,
    breakEvenPoint,
    riskAdjustedProfit,
  };
}

export function calculateReverse(inputs: ReverseCalculatorInputs): ReverseCalculatorResult {
  const { purchasePrice, desiredProfit, termMonths, downPayment } = inputs;

  const requiredMarkup = desiredProfit;
  const requiredMarkupPercent = purchasePrice > 0 ? (desiredProfit / purchasePrice) * 100 : 0;
  const totalPrice = purchasePrice + requiredMarkup;
  const remainingAmount = totalPrice - downPayment;
  const monthlyPayment = termMonths > 0 ? remainingAmount / termMonths : 0;

  return {
    requiredMarkup,
    requiredMarkupPercent,
    totalPrice,
    monthlyPayment,
  };
}

export function calculatePortfolio(inputs: PortfolioCalculatorInputs): PortfolioCalculatorResult {
  const { activeDeals, averageCheck, averageMargin, averageTerm } = inputs;

  const totalTurnover = activeDeals * averageCheck;
  const totalProfit = totalTurnover * (averageMargin / 100);
  const averageYield = averageMargin;
  const monthlyIncome = averageTerm > 0 ? totalProfit / averageTerm : 0;

  const monthlyForecast = Array.from({ length: Math.min(averageTerm, 12) }, (_, i) => {
    const date = new Date();
    date.setMonth(date.getMonth() + i + 1);
    return {
      month: date.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' }),
      amount: monthlyIncome,
    };
  });

  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (activeDeals > 20 || totalTurnover > 2_000_000) riskLevel = 'high';
  else if (activeDeals > 10 || totalTurnover > 1_000_000) riskLevel = 'medium';

  return {
    totalTurnover,
    totalProfit,
    averageYield,
    monthlyForecast,
    riskLevel,
  };
}
