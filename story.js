import * as d3 from "d3";
import { density1d } from "fast-kde";

const bias_mapping = {
    "farLeft": -3,
    "left": -2,
    "leanLeft": -1,
    "center": 0,
    "unknown": 0,
    "leanRight": 1,
    "right": 2,
    "farRight": 3
}

const EXTENT = [-3, 3];
const ANIMATION_DURATION = 5000;

class StoryVisualizer {
    constructor(containerId) {
        this.container = d3.select(`#${containerId}`);
        this.width = 800;
        this.height = 500;
        this.animationDuration = ANIMATION_DURATION;
        this.isPlaying = false;
        this.currentData = [];
        this.currentTime = null;
        this.animationStart = null;
        this.intervalId = null;
        
        this.initScales();
        this.setupControls();
        this.initSVG();
    }

    initScales() {
        this.xScale = d3.scaleTime().range([50, this.width - 50]);
        this.yScale = d3.scaleLinear()
            .domain(EXTENT)
            .range([this.height - 50, 50]);
    }

    initSVG() {
        this.svg = this.container.append("svg")
            .attr("width", this.width)
            .attr("height", this.height)
            .attr("viewBox", `0 0 ${this.width} ${this.height}`);
        
        this.createAxes();
        this.timeline = this.createTimeline();
    }

    createAxes() {
        this.svg.append("g")
            .attr("class", "x-axis")
            .attr("transform", `translate(0,${this.height - 50})`);

        this.svg.append("g")
            .attr("class", "y-axis")
            .attr("transform", "translate(50, 0)")
            .call(this.createYAxis());
    }

    createYAxis() {
        return d3.axisLeft(this.yScale)
            .tickValues([-3, -2, -1, 0, 1, 2, 3])
            .tickFormat(d => {
                if (d === -3) return "farLeft";
                if (d === 3) return "farRight";
                return d;
            });
    }

    createTimeline() {
        return this.svg.append("line")
            .attr("class", "timeline")
            .attr("x1", 50)
            .attr("x2", 50)
            .attr("y1", 50)
            .attr("y2", this.height - 50);
    }

    async loadData(url) {
        try {
            let rawData = await d3.csv(url);
            this.stories = d3.group(rawData, d => d.story_id);
            this.renderStoryList();
        } catch (error) {
            console.error("Error loading data:", error);
        }
    }

    renderStoryList() {
        const storyContainer = d3.select("#stories");
        
        storyContainer.selectAll(".story-card")
            .data([...this.stories.values()])
            .join("div")
            .attr("class", "story-card")
            .html(d => `
                <h3>${d[0].title}</h3>
                <p>${d[0].description}</p>
                <small>${d.length} sources</small>
            `)
            .on("click", (event, storyData) => this.setupStory(storyData));
    }

    updateScales() {
        this.xScale.domain(this.timeDomain);
        this.svg.select(".x-axis")
            .transition()
            .duration(300)
            .call(d3.axisBottom(this.xScale));
    }

    setupControls() {
        const playButton = document.getElementById("playButton");
        playButton.addEventListener("click", () => this.togglePlayback());
    }

    setupStory(storyData) {
        this.resetVisualization();
        
        this.sources = storyData
            .map((d, i) => ({
                id: i,
                name: d.source_name,
                bias: parseFloat(bias_mapping[d.source_bias]),
                date: new Date(d.date),
                title: d.article_title,
                url: d.url
            }))
            .filter(d => !isNaN(d.bias))
            .sort((a, b) => a.date - b.date);

        this.timeDomain = d3.extent(this.sources, d => d.date);
        this.updateScales();
    }

    togglePlayback() {
        this.isPlaying = !this.isPlaying;
        document.getElementById("playButton").textContent = 
            this.isPlaying ? "⏸ Pause" : "▶ Play";
        
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
        
        // Calculate current date
        const currentDate = new Date(
            this.timeDomain[0].getTime() + 
            progress * (this.timeDomain[1].getTime() - this.timeDomain[0].getTime())
        );

        // Update visible data points
        this.currentData = this.sources.filter(d => d.date <= currentDate);
        
        this.updateVisualization(currentDate);
        
        if (this.isPlaying && elapsed < this.animationDuration) {
            this.animationFrame = requestAnimationFrame(() => this.animate());
        } else {
            this.isPlaying = false;
            document.getElementById("playButton").textContent = "▶ Play";
        }
    }

    updateVisualization(currentDate) {
        this.updateTimeline(currentDate);
        this.updateTimeDisplay(currentDate);
        this.updateDataPoints();
        this.updateDistribution(currentDate);
    }

    updateTimeline(currentDate) {
        this.timeline.attr("x1", this.xScale(currentDate))
            .attr("x2", this.xScale(currentDate));
    }

    updateTimeDisplay(currentDate) {
        document.getElementById("timeDisplay").textContent = 
            d3.timeFormat("%B %d, %Y")(currentDate);
    }

    updateDataPoints() {
        const points = this.svg.selectAll(".data-point")
            .data(this.currentData, d => d.id);

        points.enter()
            .append("circle")
            .attr("class", "data-point")
            .attr("cx", d => this.xScale(d.date))
            .attr("cy", d => this.yScale(d.bias))
            .attr("r", 8)
            .style("fill", d => d.bias < 0 ? "#3498db" : "#e74c3c")
            .style("opacity", 0)
            .transition()
            .duration(300)
            .style("opacity", 1);

        points.exit()
            .transition()
            .duration(300)
            .style("opacity", 0)
            .remove();
    }

    updateDistribution(currentDate) {
        if (this.currentData.length < 2) return;
        
        const biases = this.currentData.map(d => d.bias);
        const estimator = density1d(biases, { bandwidth: 0.2, extent: EXTENT });
        const kde = Array.from(estimator);
        
        // Smooth transition for distribution
        const t = d3.transition()
            .duration(100)
            .ease(d3.easeQuadInOut);

        const area = d3.area()
            .x0(d => this.xScale(currentDate) - (d.y * 80))
            .x1(d => this.xScale(currentDate) + (d.y * 80))
            .y(d => this.yScale(d.x))
            .curve(d3.curveCatmullRom);

        const paths = this.svg.selectAll(".distribution")
            .data([kde]);

        paths.enter()
            .append("path")
            .attr("class", "distribution")
            .merge(paths)
            .transition(t)
            .attr("d", area)
            .style("fill", "currentColor")
            .style("opacity", 0.2);

        paths.exit().remove();
    }

    resetVisualization() {
        this.currentData = [];
        this.currentTime = null;
        this.isPlaying = false;
        cancelAnimationFrame(this.animationFrame);
        document.getElementById("playButton").textContent = "▶ Play";
        
        this.svg.selectAll(".data-point, .distribution").remove();
        this.timeline.attr("x1", 50).attr("x2", 50);
        document.getElementById("timeDisplay").textContent = "";
    }
}

// Initialize application
(async () => {
    try {
        const visualizer = new StoryVisualizer("visualization");
        await visualizer.loadData("climate-change_articles.csv");
    } catch (error) {
        console.error("Application initialization failed:", error);
    }
})();
