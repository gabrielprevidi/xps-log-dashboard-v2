import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatarData(data: string): string {
  return new Date(data).toLocaleDateString('pt-BR')
}

export function formatarDataHora(data: string): string {
  return new Date(data).toLocaleString('pt-BR')
}

export function formatarMes(competencia: string): string {
  const [ano, mes] = competencia.split('-')
  const meses = [
    'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
    'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
  ]
  return `${meses[parseInt(mes) - 1]} ${ano}`
}

export function obterMesAno(competencia: string): { mes: number; ano: number } {
  const [ano, mes] = competencia.split('-')
  return { mes: parseInt(mes), ano: parseInt(ano) }
}
