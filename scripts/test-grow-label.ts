/**
 * Testes da leitura de pallets da Grow Label (TUBOMAIS / C.R. Embalagens).
 * Textos reduzidos de emails e DANFEs reais de out–nov/2026.
 *
 *   npm run test:grow-label
 */
import { ehNotaCoberturaSemPallet, notasReferenciadas, palletsDaCobertura } from '../lib/grow-label.ts'

let falhas = 0
const eq = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado)
  if (!ok) falhas++
  console.log(`${ok ? '✓' : '✗'} ${nome}${ok ? '' : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`)
}

const pdf49548 = 'DADOS ADICIONAIS INF. CONTRIBUINTE: MATERIAL DE NOSSA PROPRIEDADE QUE ESTAMOS ENVIANDO PARA ARMAZENAGEM REF A NOTA 18306 DE 27/10/2026 TUBOMAIS INDUST.DE PAPEL LTDA - NÃO INCIDE'
const pdf49565 = 'REF A NOTA 18313 DE TUBOMAIS INDUSTRIA E COMER.DE PAPEIS LTDA 28/10/2026 LTDA - NÃO INCIDE'
const pdf49711 = 'MATERIAL QUE ESTAMOS ENVIANDO PARA ARMAZEM REF. A NF 23.344 04/11/26 C.R. EMBALAGENS LTDA. - NÃO INCIDE'
const pdf49855 = 'ENVIANDO PARA ARMAZÉM REFERENTE A NF 23402 DA DATA 10/11/2026 C. R. EMBALAGENS LTD - NÃO INCIDE'
const pdfFedrigoni = 'REMESSA PARA DEPOSITO FECHADO FEDRIGONI SELF-ADHESIVES'

const corpoTubomais = `Boa Tarde,
Segue
NF 49548 referente a nota 18306
NF 49565 referente a nota 18313
De: flavio.santos@xpslog.com.br
Assunto: GROW LABEL - ARMAZENAR
Segue abaixo as notas fiscais que recebemos, seguir com a nota de cobertura por gentileza. Obrigado!
DATA
DANFES
FORNECEDOR
VOLUMES
29/10/2026
101063
FEDRIGONI
2
28/10/2026
18313
TUBOMAIS
14
27/10/2026
18306
TUBOMAIS
2
28/10/2026
18318
TUBOMAIS
 13
TOTAL
31`

const corpoCr = `Boa Tarde,
Segue NF 49711 referente a nota 23.344
> DATA
> DANFES
> FORNECEDOR
> VOLUMES
> 04/11/2026
> 23345
> C.R. EMBALAGENS
> 7
> TOTAL
>  7`

const corpoHtml = `<table><tr><td>DATA</td><td>DANFES</td><td>FORNECEDOR</td><td>VOLUMES</td></tr>
<tr><td>10/11/2026</td><td>23402</td><td>C.R. EMBALAGENS</td><td>18</td></tr></table>`

const corpoLinha = 'DATA DANFES FORNECEDOR VOLUMES\n10/11/2026 23402 C.R. EMBALAGENS 18\nTOTAL 18'

eq('detecta TUBOMAIS', ehNotaCoberturaSemPallet(pdf49548), true)
eq('detecta C. R. EMBALAGENS com espaço', ehNotaCoberturaSemPallet(pdf49855), true)
eq('ignora nota comum', ehNotaCoberturaSemPallet(pdfFedrigoni), false)

eq('ref "REF A NOTA"', notasReferenciadas(pdf49548), ['18306'])
eq('ref com fornecedor depois do número', notasReferenciadas(pdf49565), ['18313'])
eq('ref "REF. A NF 23.344" (milhar com ponto)', notasReferenciadas(pdf49711), ['23344'])
eq('ref "REFERENTE A NF"', notasReferenciadas(pdf49855), ['23402'])
eq('ref múltipla', notasReferenciadas('REF A NOTAS 18306 E 18318 TUBOMAIS'), ['18306', '18318'])

eq('49548 → 2 pallets (espécie dizia 31)', palletsDaCobertura(pdf49548, '49548', corpoTubomais).pallets, 2)
eq('49565 → 14 pallets', palletsDaCobertura(pdf49565, '49565', corpoTubomais).pallets, 14)
eq('soma de várias referências', palletsDaCobertura('REF A NOTAS 18306 E 18318 TUBOMAIS', 'x', corpoTubomais).pallets, 15)
eq('tabela em HTML', palletsDaCobertura(pdf49855, '49855', corpoHtml).pallets, 18)
eq('tabela em linha única', palletsDaCobertura(pdf49855, '49855', corpoLinha).pallets, 18)
eq('fallback pelo corpo quando PDF não tem REF',
  palletsDaCobertura('TUBOMAIS', '49565', corpoTubomais), { pallets: 14, referencias: ['18313'], faltando: [] })

// NF referenciada errada pela Grow (23.344; a logística contou a 23345):
// não chuta — fica sem pallets para lançamento manual.
eq('referência ausente da tabela → null', palletsDaCobertura(pdf49711, '49711', corpoCr),
  { pallets: null, referencias: ['23344'], faltando: ['23344'] })
eq('sem corpo → null', palletsDaCobertura(pdf49548, '49548', '').pallets, null)
eq('corpo sem tabela VOLUMES → null', palletsDaCobertura(pdf49548, '49548', 'NF 49548 referente a nota 18306').pallets, null)

console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos passaram')
process.exit(falhas ? 1 : 0)
