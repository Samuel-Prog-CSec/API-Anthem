# Calidad del aire
- Sensores: Anthem_CTC_Aire_XXX.csv
- Aclaraciones:
  - El  campo  punto  de  muestreo  incluye  el  código de  la  estación  completo  (provincia, municipio y estación) más la magnitud y la técnica de muestreo.
  - H01  corresponde  al  dato  de  la  1  de  la  mañana  de  ese  día,  V01  es  el  código  de validación, H02 al de las 2 de la mañana, V02 y así sucesivamente.
  - Únicamente son válidos los datos de validación con el valor “V".

# Contaminación acústica
- Sensor: Anthem_CTC_ContaminacionAcustica.csv
- Aclaraciones:
  - NMT: indica el número de la estación de monitorización de ruido a la que corresponde el  registro  diario  de  contaminación  acústica.  Para  más  detalles  acerca  de  dichas estaciones,  véase  el  conjunto  de  datos  «Contaminación  acústica:  estaciones  de medida».
  - Año, mes y día: indican la fecha a la que corresponde el registro diario de contaminación acústica.
  - Tipo:  indica  el  periodo  del  día  establecido  al  cual  corresponde  el  registro  diario  de contaminación acústica. Los tipos de registros diarios y sus periodos correspondientes se definen a continuación:
    - Tipo D: indica que el registro diario corresponde al periodo diurno, i.e., desde las 07:00 horas hasta las 19:00 horas.
    - Tipo  E:  indica  que  el  registro  diario  corresponde  al  periodo  vespertino,  i.  e., desde las 19:00 horas hasta las 23 horas.
    - Tipo N: indica que el registro diario corresponde al periodo nocturno, i. e., desde las 23:00 horas del día anterior hasta las 07:00 horas.
    - Tipo T: indica que el registro diario corresponde al periodo que abarca las 24 horas del día.
  - LAEQ:  nivel  de  presión  acústica  ponderada  A  continuo  equivalente  del  periodo  de medida  (expresado  en  decibelios con  ponderación  A).  Indica  el  nivel  de  presión acústica  ponderada  A  que  debería  tener  un  sonido  constante durante  el  periodo  de medida  para  contener  la  misma  energía  acústica  que  el  sonido  variable  medido  en dicho periodo de medida.

# Multas (Fines)
- Sensores: Anthem_CTC_Multas_XXX.csv
- Aclaraciones:
  - Calificacion: tipo de infracción (m. Grave, leve...).
  - Lugar:  lugar de infracción.
  - Fdenun: fecha de denuncia (mm/yyyy).
  - Hora: hora de la denuncia (hh.mm).
  - Imp_bol: importe del boletín.
  - Descuento: descuento ‘si’ , ‘no’.
  - Puntos: puntos detraídos.
  - Denunciante: denunciante.
  - Hecho-bol: hecho denunciado.
  - Vel_limite: velocidad límite (si es de radar).
  - Vel_circula: velocidad medida (si es de radar).
  - Coordenada-x: coordenada x.
  - Coordenada-y: coordenada y.
  - Num-boletines: número de registros agrupados.
  - Importe: importe agrupado.

# Censo
- Sensores: Anthem_CTC_Censo_XXX.csv
- Aclaraciones:
  - Cod_distrito: código del distrito municipal.
  - Desc_distrito: literal de distrito.
  - Cod_dist_barrio: código de distrito-barrio.
  - Desc_barrio: literal de bario.
  - Cod_barrio: código de barrio.
  - Cod_dist_seccion: código de distrito-sección.
  - Cod_seccion: código de sección.
  - Cod_edad_int: edad simple calculada a la fecha de extracción de los datos.
  - Españoleshombres: total hombres españoles.
  - Españolesmujeres: total mujeres españolas.
  - Extranjeroshombres: total hombres extranjeros.
  - Extranjerosmujeres: total mujeres extranjeras.

# Ubicaciones
- Sensores:
  - Anthem_CTC_Cercanias.gpx
  - Anthem_CTC_Autobus.gpx
  - Anthem_CTC_Interurbano.gpx
  - Anthem_CTC_Metro.gpx
  - Anthem_CTC_MetroLigero.gpx
  - Anthem_CTC_Taxi.gpx
  - Anthem_CTC_EstacionesMedidaContr lAcustico.csv
  - Anthem_CTC_PuntoMedidaTrafico.csv
- Aclaraciones (Generales):
  Reflejan las ubicaciones de distintos puntos de interés de nuestra infraestructura, con distintos formatos.
- Aclaraciones (Anthem_CTC_PuntoMedidaTrafico.csv):
  - cod_cent: Código de centralización en los sistemas y que se corresponde con el campo <código> de otros conjuntos de datos como el de intensidad del tráfico en tiempo real.
  - id: Identificador único y permanente del punto de medida.
  nombre: Denominación del punto de medida
  - tipo_elem: Descriptor de la tipología del punto de medida según la siguiente codificación:
    - URB (tráfico URBANO) para dispositivos de control semafórico.
    - M-30  (tráfico  INTERURBANO) para  dispositivos de  vías  rápidas  y accesos a Anthem.
  - x:  Coordenada X_UTM  del  centroide  de  la  representación  del polígono  del punto de medida.
  - y:  Coordenada  Y_UTM  del  centroide  de  la  representación  del polígono  del punto de medida.

# Trafico
- Sensores: Anthem_CTC_Traffic_XXX.csv
- Aclaraciones:
  - Idelem: Identificación única del Punto de Medida en los sistemas de control del tráfico (ver Anthem_CTC_PuntoMedidaTrafico.csv).
  - Fecha: Fecha y hora oficiales con formato yyyy-mm-dd hh:mi:ss
  - Identif: Identificador del Punto de Medida en los Sistemas de Tráfico (se proporciona por compatibilidad hacia atrás).
  - Tipo_elem: Nombre del Tipo de Punto de Medida: Urbano o M30.
  - Intensidad: Intensidad del Punto de Medida en el periodo de 15 minutos (vehículos/hora). Un valor negativo implica la ausencia de datos.
  - Ocupacion: Tiempo de Ocupación del Punto de Medida en el periodo de 15 minutos (%). Un valor negativo implica la ausencia de datos.
  - Carga: Carga de vehículos en el periodo de 15 minutos. Parámetro que tiene en cuenta intensidad, ocupación y capacidad de la vía y establece el grado de uso de la vía de 0 a 100. Un valor negativo implica la ausencia de datos.
  - Vmed:  Velocidad  media  de  los  vehículos  en  el  periodo  de 15  minutos  (Km./h). Sólo para  puntos  de  medida  interurbanos  M30.  Un  valor  negativo  implica  la  ausencia  de  datos.
  - Error:  Indicación  de  si  ha  habido  al  menos  una  muestra  errónea  o  sustituida  en  el periodo de 15 minutos.
    - N: no ha habido errores ni sustituciones
    - E:  los  parámetros  de  calidad  de  alguna  de  las  muestras  integradas  no  son óptimos.
    - S:  alguna  de  las  muestras  recibidas  era  totalmente  errónea  y  no  se  ha
    integrado.
  - Periodo_integracion: Número de muestras recibidas y consideradas para el periodo de integración.

# Accidentalidad
- Sensor: Anthem_CTC_Accidentalidad.csv
- Aclaraciones:
  - Nº expediente: aaaasnnnnnn, donde:
    - aaaa es el año del accidente.
    - s cuando se trata de un expediente con accidente.
    - nnnnnn es un número correlativo por año.
  - Los registros que tienen el mismo número de parte corresponden se trata del mismo accidente donde hay varios afectados.
  - Fecha: fecha en formato dd/mm/aaaa
  - Hora: la hora se establece en rangos horarios de 1 hora
  - Calle: calle 1 - calle 2 (cruce) o una calle
  - Número: número de la calle, cuando tiene sentido
  - Distrito: nombre del distrito
  - Tipo accidente: Colisión doble, Colisión múltiple, Alcance, Choque contra obstáculo o elemento de la vía, Atropello a persona, Vuelco, Caída, Otras causas
  - Estado  meteorológico:  condiciones  ambientales  que  se  dan  en  el  momento  del siniestro.
  - Tipo vehículo: tipo de vehículo afectado
  - Tipo persona: conductor, peatón, testigo o viajero
  - Tramo edad: tramo de edad de la persona afectada
  - Sexo: hombre, mujer o no asignado
  - Lesividad:
    - 01 o Atención en urgencias sin posterior ingreso. - LEVE
    - 02 Ingreso inferior o igual a 24 horas - LEVE
    - 03 Ingreso superior a 24 horas. - GRAVE
    - 04 Fallecido 24 horas - FALLECIDO
    - 05 Asistencia sanitaria ambulatoria con posterioridad - LEVE
    - 06 Asistencia sanitaria inmediata en centro de salud o mutua - LEVE
    - 07 Asistencia sanitaria sólo en el lugar del accidente - LEVE
    - 14 Sin asistencia sanitaria
    - 77 Se desconoce
    - En blanco Sin asistencia sanitaria

# Asignación de patinetes
- Sensor: Anthem_CTC_AsignaciónPatinetes.csv
- Aclaraciones:
  - Para  cada  distrito  y  barrio,  se  mostrará  el  número  de  patinetes  disponible  por  cada proveedor.

# Disponibilidad de bicicletas eléctricas
- Sensor: Anthem_CTC_Bicicletas_Disponibilidad.csv
- Aclaraciones:
  - Dia: día seleccionado
  - Horas_totales_usos_bicicletas:  nº total de  horas que los  usuarios han  utilizado bicicletas en el día seleccionado
  - Horas_totales_disponibilidad_bicicletas_en_anclajes: nº de horas en las que ha habido bicicletas disponibles en los anclajes en el día seleccionado
  - Total_horas_servicio_bicicletas:  sumatorio  de  las  dos  anteriores  (horas  de  uso  y disponibilidad)
  - Media_bicicletas_disponibles:  es  el  resultado  de  dividir  por  24  h  el  total  de  horas servicio de bicicletas en el día seleccionado
  - Usos_abonado_anual: nº de viajes efectuados por usuarios de abono anual en el día indicado
  - Usos_abonado_ocasional: nº de viajes efectuados por usuarios de abono ocasional en el día indicado
  - Total_usos: nº total de viajes (suma de los dos anteriores)

# Contenedores
- Sensor: Anthem_CTC_Contenedores_Ubicacion.csv
- Aclaraciones:
  - Código Interno del Situado: Código identificación del situado / Punto de aportación.
  - Tipo  Contenedor:  Tipo  de  Residuo:  (ORGÁNICA,  RESTO,  ENVASES,  VIDRIO  Y PAPELCARTÓN).
  - Modelo: Clasificación de contenedor. Codificación propia.
  - Descripción Modelo: Tipo de contenedor.
  - Cantidad: Número de contenedores en el situado.
  - Lote: Lote al que pertenece (LOTES 1,2 o 3).
  - Distrito: Código del Distrito.
  - Barrio: Código del barrio.
  - Tipo Via: Clase de vía (calle, plaza, etc.)
  - Nombre: Denominación de la vía.
  - Número: Número de la vía.
  - CoordenadaX: Situación del objeto en su coordenada X en medida UTM (en centímetros).
  - CoordenadaY: Situación del objeto en su coordenada Y en medida UTM (en centímetros).

# Notas transversales (BI)

Este bloque documenta convenciones que cruzan varios datasets y que conviene
tener presentes al diseñar consultas o cuadros comparativos.

## Periodizaciones del día (NO son intercambiables)

Distintos datasets dividen el día en franjas distintas porque cada uno
responde a una normativa o patrón de uso distinto. Cruzarlas como si fueran
la misma puede inducir conclusiones falsas.

| Dataset    | Periodos                                                        | Origen                                                              |
| ---------- | --------------------------------------------------------------- | ------------------------------------------------------------------- |
| Ruido      | D 07-19, E 19-23, N 23-07 (T = 24h)                             | Directiva 2002/49/CE, Ley 37/2003, RD 1367/2007                     |
| Tráfico    | 00-07, 07-12, 12-15, 15-21, 21-00                               | Patrones de movilidad urbana del propio dataset                     |
| Multas     | hora exacta (HH.MM) sin discretizar                             | Tal cual lo emite el sensor de denuncia                             |
| Accidentes | franja en formato texto en columna `RANGO HORARIO`              | Discretización propia del CSV de accidentalidad                     |

Implicación: cuando se quiera correlacionar (p. ej. ruido vs. tráfico por
franja), hay que reagrupar a una rejilla común — habitualmente las franjas
horarias de ruido D/E/N — derivando los valores de tráfico a esa rejilla.

## Coordenadas

Todos los datasets con georreferencia se canalizan por
`scripts/importation/helpers/coordenadas.js`. Convenciones internas tras la
importación:

- UTM se almacena SIEMPRE en metros (ETRS89 zona 30N, EPSG:25830). El CSV
  de Contenedores trae las coordenadas en centímetros y el helper aplica
  la conversión cm → m.
- Para WGS84 se respeta el formato GeoJSON RFC 7946: `[longitud, latitud]`
  en grados decimales.
- Cuando el CSV trae UTM y WGS84 simultáneamente (estaciones acústicas y
  puntos de tráfico), la fuente prioritaria es WGS84; UTM se conserva como
  metadato. Si las dos discrepan más de ~0.01° (~1 km) se registra una
  advertencia, pero no se rechaza la fila.

Más detalle en `docs/Coordenadas.md`.

## Multas: campo `metadatos.calificacionInferida`

El CSV de multas trae a veces la columna CALIFICACION vacía o con valores
fuera de {LEVE, GRAVE, MUY GRAVE}. En esos casos el importador asigna LEVE
por defecto y marca `metadatos.calificacionInferida = true`. Para cuadros
BI que comparen severidades, conviene filtrar o segmentar por ese flag —
de lo contrario LEVE saldría sobrerrepresentado por absorber filas
realmente desconocidas.
