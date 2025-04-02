import * as d3 from "d3";
import { density1d } from "fast-kde";

// Shared constants
const bias_mapping = {
    "farLeft": -3,
    "left": -2,
    "leanLeft": -1,
    "center": 0,
    "unknown": 0,
    "leanRight": 1,
    "right": 2,
    "farRight": 3
};

const source_bias_colors = {
    "-3": "#0072B2",
    "-2": "#56B4E9",
    "-1": "#92C5DE",
    "0": "#D0D1D5",
    "1": "#F4A582",
    "2": "#CA0020",
    "3": "#D01719"
};

const EXTENT = [-2, 2];
const ANIMATION_DURATION = 5000;

// Helper function
const numbered = (num) => {
    return num === 1 ? "1st" : num === 2 ? "2nd" : num === 3 ? "3rd" : num + "th";
};

// StoryList Component
class StoryList {
    constructor(containerId, onStorySelect) {
        this.container = d3.select(`#${containerId}`);
        this.onStorySelect = onStorySelect;
        this.stories = [];
    }

    async loadData(url) {
        try {
            this.stories = await d3.json(url);
            this.render();
        } catch (error) {
            console.error("Error loading data:", error);
        }
    }

    render() {
        this.container.selectAll(".story-card")
            .data(this.stories)
            .join("div")
            .attr("class", "story-card")
            .html(d => `
                <h3>${d.title}</h3>
                <p>${d.description}</p>
                <div class="metrics">
                    <div class="metric">
                        <span class="label">Sources:</span>
                        <span class="value">${d.articles.length}</span>
                    </div>
                    <div class="metric">
                        <span class="label">Controversy:</span>
                        <span class="value">${d.surprise_index.toFixed(2)}</span>
                    </div>
                </div>
                ${d.first_to_threshold ? `
                <div class="threshold">
                    Polarized from the ${numbered(d.first_to_threshold)} post
                </div>` : ''}
            `)
            .on("click", (event, storyData) => {
                this.onStorySelect(storyData);
            });
    }
}

// StoryModal Component
class StoryModal {
    constructor() {
        this.modal = d3.select("#storyModal");
        this.visualization = new StoryTimeline("modalVisualization");
        this.setupHandlers();
    }

    setupHandlers() {
        d3.select(".close").on("click", () => this.close());
        this.modal.on("click", (event) => {
            if (event.target === this.modal.node()) this.close();
        });
    }

    open(storyData) {
        this.renderArticles(storyData.articles);
        this.visualization.setupStory(storyData);
        this.modal.style("display", "block");
    }

    close() {
        this.modal.style("display", "none");
        this.visualization.resetVisualization();
    }

    renderArticles(articles) {
        const container = d3.select("#articlesContainer");
        container.html("");

        articles.forEach(article => {
            const item = container.append("div")
                .attr("class", "article-item");

            if (article.article_image_url) {
                item.append("img")
                    .attr("src", article.article_image_url)
                    .attr("loading", "lazy")
                    .attr("alt", article.title);
            }

            item.append("div")
                .attr("class", "article-info")
                .html(`
                    <h4><a href="${article.url}" class="article-link" target="_blank">${article.title}</a></h4>
                    <div class="source-info">
                        <span class="source-name">${article.source_name}</span>
                        <span class="bias-tag" style="background:${source_bias_colors[bias_mapping[article.source_bias]]}">
                            ${article.source_bias}
                        </span>
                    </div>
                `);
        });
    }
}


// StoryTimeline Component
class StoryTimeline {
    constructor(containerId) {
        this.container = d3.select(`#${containerId}`);
        this.width = 900;
        this.height = 500;
        this.animationDuration = ANIMATION_DURATION;
        this.isPlaying = false;
        this.currentData = [];
        this.currentTime = null;
        this.animationStart = null;
        this.animationFrame = null;
        
        this.initScales();
        this.initSVG();
        this.createLegend(); // Add legend creation
    }

    initScales() {
        // X scale remains the same
        this.xScale = d3.scaleTime().range([75, this.width - 75]);
        // Y scale for bias (left axis)
        this.yScale = d3.scaleLinear()
            .domain(EXTENT)
            .range([this.height - 50, 50]);
        // New polarization scale for the right axis.
        // Domain here is hardcoded to [0, 2] (adjust if needed)
        // and the range is chosen to position the axis within the view.
        this.polScale = d3.scaleLinear()
            .domain([0, 1])
            .range([this.height - 50, 50]);
    }

    initSVG() {
        this.svg = this.container.append("svg")
            .attr("width", this.width)
            .attr("height", this.height)
            .attr("viewBox", `0 0 ${this.width} ${this.height}`);

        this.tooltip = this.container.append("div")
            .attr("class", "tooltip")
            .style("opacity", 0);
        
        this.createAxes();
        this.timeline = this.createTimeline();
    }

    createAxes() {
        // X-axis (bottom)
        this.svg.append("g")
            .attr("class", "x-axis")
            .attr("transform", `translate(0,${this.height - 50})`)
            .call(d3.axisBottom(this.xScale));

        // Left Y-axis for bias
        this.svg.append("g")
            .attr("class", "y-axis")
            .attr("transform", "translate(75, 0)")
            .call(
                d3.axisLeft(this.yScale)
                    .tickValues([-2, -1, 0, 1, 2])
                    .tickFormat(d => {
                        if (d === -2) return "Left";
                        if (d === 2) return "Right";
                        return d;
                    })
            );

        // Add left axis title
        this.svg.append("text")
            .attr("class", "y-axis-title")
            .attr("transform", "rotate(-90)")
            .attr("x", -this.height / 2)
            .attr("y", 30)
            .attr("text-anchor", "middle")
            .style("font-size", "14px")
            .text("Article Bias");

        // New right Y-axis for polarization
        this.svg.append("g")
            .attr("class", "polarization-axis")
            .attr("transform", `translate(${this.width - 75}, 0)`)
            .call(
                d3.axisRight(this.polScale)
                    .ticks(5)
                    .tickFormat(d => d.toFixed(1))
            );

        // Add right axis title
        this.svg.append("text")
            .attr("class", "pol-axis-title")
            .attr("transform", "rotate(90)")
            .attr("x", this.height / 2)
            .attr("y", -this.width + 30)
            .attr("text-anchor", "middle")
            .style("font-size", "14px")
            .text("Polarization");
    }

    createTimeline() {
        return this.svg.append("line")
            .attr("class", "timeline")
            .attr("x1", 50)
            .attr("x2", 50)
            .attr("y1", 50)
            .attr("y2", this.height - 50);
    }

    // Add this new method to create the legend
    createLegend() {
        const legend = this.svg.append("g")
            .attr("class", "legend")
            .attr("transform", `translate(${this.width - 180}, 20)`);

        // Legend title
        legend.append("text")
            .attr("class", "legend-title")
            .attr("x", 0)
            .attr("y", -10)
            .attr("font-size", "14px")
            .text("Outlet bias ratings");

        const legendItems = [
            { label: "Far Left", color: source_bias_colors["-3"] },
            { label: "Left", color: source_bias_colors["-2"] },
            { label: "Lean Left", color: source_bias_colors["-1"] },
            { label: "Center", color: source_bias_colors["0"] },
            { label: "Lean Right", color: source_bias_colors["1"] },
            { label: "Right", color: source_bias_colors["2"] },
            { label: "Far Right", color: source_bias_colors["3"] }
        ];

        legend.selectAll(".legend-item")
            .data(legendItems)
            .enter()
            .append("g")
            .attr("class", "legend-item")
            .attr("transform", (d, i) => `translate(0, ${i * 20})`)
            .each(function(d) {
                d3.select(this)
                    .append("circle")
                    .attr("r", 5)
                    .attr("cx", 10)
                    .attr("cy", 10)
                    .attr("fill", d.color);

                d3.select(this)
                    .append("text")
                    .attr("x", 20)
                    .attr("y", 15)
                    .attr("font-size", "12px")
                    .text(d.label);
            });
    }

    setupStory(storyData) {
        this.resetVisualization();
        
        this.sources = storyData.articles
            .map((d, i) => ({
                id: i,
                name: d.source_name,
                source_bias: bias_mapping[d.source_bias],
                bias: parseFloat(d.bias) - 2,
                date: new Date(d.date),
                title: d.title,
                url: d.url,
                image: d.article_image_url
            }))
            .filter(d => !isNaN(d.bias))
            .sort((a, b) => a.date - b.date);

        // Store polarization data (expected as an array of numbers)
        this.polarization = storyData.polarization;
        this.timeDomain = d3.extent(this.sources, d => d.date);
        this.updateScales();
        this.togglePlayback();
    }

    updateScales() {
        this.xScale.domain(this.timeDomain);
        this.svg.select(".x-axis")
            .transition()
            .duration(300)
            .call(d3.axisBottom(this.xScale));
    }

    togglePlayback() {
        this.isPlaying = !this.isPlaying;
        
        if (this.isPlaying) {
            this.animationStart = Date.now() - (this.currentTime || 0);
            this.animate();
        } else {
            cancelAnimationFrame(this.animationFrame);
        }
    }

    animate() {
        const elapsed = Date.now() - this.animationStart;
        this.currentTime = Math.min(elapsed, this.animationDuration);
        const progress = this.currentTime / this.animationDuration;
        
        const currentDate = new Date(
            this.timeDomain[0].getTime() + 
            progress * (this.timeDomain[1].getTime() - this.timeDomain[0].getTime())
        );

        this.currentData = this.sources.filter(d => d.date <= currentDate);
        this.updateVisualization(currentDate);
        
        if (this.isPlaying && elapsed < this.animationDuration) {
            this.animationFrame = requestAnimationFrame(() => this.animate());
        } else {
            this.isPlaying = false;
        }
    }

    updateVisualization(currentDate) {
        this.updateTimeline(currentDate);
        this.updateDataPoints();
        // this.updateDistribution(currentDate);
        this.updatePolarizationTrend(currentDate); // New polarization trend update
    }

    updateTimeline(currentDate) {
        this.timeline.attr("x1", this.xScale(currentDate))
            .attr("x2", this.xScale(currentDate));
    }

    updateDataPoints() {
        const tooltip = this.tooltip;

        const points = this.svg.selectAll(".data-point")
            .data(this.currentData, d => d.id);
    
        points.enter()
            .append("circle")
            .attr("class", "data-point")
            .attr("cx", d => this.xScale(d.date))
            .attr("cy", d => this.yScale(d.bias))
            .attr("r", 8)
            .style("fill", d => source_bias_colors[d.source_bias])
            .style("opacity", 0)
            .on("mouseover", function(event, d) {
                tooltip
                    .html(d.name)
                    .style("opacity", 1)
                    .style("left", `${event.clientX}px`)
                    .style("top", `${event.clientY}px`);
            })
            .on("mousemove", function(event) {
                tooltip
                    .style("left", `${event.clientX}px`)
                    .style("top", `${event.clientY}px`);
            })
            .on("mouseout", function() {
                tooltip.style("opacity", 0);
            })
            .transition()
            .duration(300)
            .style("opacity", 1);
    
        points.exit()
            .transition()
            .duration(300)
            .style("opacity", 0)
            .remove();
    }

    // Updated polarization trend using the new polScale and added right axis.
    updatePolarizationTrend(currentDate) {
        if (!this.polarization || this.polarization.length < 2) return;
        
        // Use the xScale (time) and our polarization scale (right axis) for y.
        const xScale = this.xScale;
        const yScale = this.polScale;

        // Line generator for polarization trend.
        const line = d3.line()
            .x((_, i) => xScale(this.sources[i].date))
            .y(d => yScale(d))
            .curve(d3.curveStepAfter);
        
        // Update or create the polarization trend path.
        const trend = this.svg.selectAll(".polarization-trend")
            .data([this.polarization]);
            
        trend.enter()
            .append("path")
            .attr("class", "polarization-trend")
            .merge(trend)
            .attr("d", line)
            .style("fill", "none")
            .style("stroke", "#e74c3c")
            .style("stroke-width", 2)
            .style("opacity", 0.7);
            
        // Add current position indicator on the polarization axis.
        const indicator = this.svg.selectAll(".trend-indicator")
            .data([currentDate]);
            
        indicator.enter()
            .append("circle")
            .attr("class", "trend-indicator")
            .merge(indicator)
            .attr("cx", d => xScale(currentDate))
            .attr("cy", d => yScale(this.polarization[this.currentData.length - 1]))
            .attr("r", 5)
            .style("fill", "#e74c3c")
            .style("stroke", "white")
            .style("stroke-width", 1);
            
        trend.exit().remove();
        indicator.exit().remove();
    }

    resetVisualization() {
        this.currentData = [];
        this.currentTime = null;
        this.isPlaying = false;
        cancelAnimationFrame(this.animationFrame);
        
        this.svg.selectAll(".data-point, .distribution, .polarization-trend, .trend-indicator").remove();
        this.timeline.attr("x1", 50).attr("x2", 50);
    }
}


// Main Application
class StoryVisualizerApp {
    constructor() {
        this.storyList = new StoryList("stories", (articles) => {
            this.modal.open(articles);
        });
        this.modal = new StoryModal();
    }

    async init() {
        try {
            await this.storyList.loadData("dist/climate-change.json");
        } catch (error) {
            console.error("Application initialization failed:", error);
        }
    }
}

// Initialize application
const app = new StoryVisualizerApp();
app.init();
