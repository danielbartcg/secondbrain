/**
 * Extension « force-directed » d'amCharts 4 (graphe des liens), chargée à la
 * demande par `KnowledgeGraph`. Le cœur et les graphiques sont importés
 * statiquement avant elle : importée seule, l'extension casse l'ordre
 * d'initialisation des modules amCharts (« Class extends value undefined »).
 */
import "@amcharts/amcharts4/core";
import "@amcharts/amcharts4/charts";

export * from "@amcharts/amcharts4/plugins/forceDirected";
