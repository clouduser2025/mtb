import React, { useState, useEffect, useRef } from 'react';
import { Container, Button, Table, Form, Alert, Modal, Row, Col, Dropdown, ButtonGroup } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faUserCog, 
  faUserPlus, 
  faUsers, 
  faSignInAlt, 
  faShoppingCart, 
  faExchangeAlt,
  faUser,               
  faUserTie,
  faChartLine,
  faDollarSign,
  faChartBar,
  faHourglassHalf,
  faBullseye,
  faMapMarkerAlt
} from '@fortawesome/free-solid-svg-icons'; 
import './css/landing.css';

const Landing = () => {
  /********************************************************
   *           STATES & REGISTRATION SETUP              *
   ********************************************************/
  const [users, setUsers] = useState([]); 
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [openTrades, setOpenTrades] = useState([]);  
  const [showTradesDashboard, setShowTradesDashboard] = useState(false);
  const [formStep, setFormStep] = useState(1); // 1: Select Users, 2: Trade Conditions, 3: Confirm Trade
  const [actionType, setActionType] = useState(null); // 'buy' or 'sell'

  // Initialize formData with all fields (added default_quantity to match registration form)
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    broker: "Angel",
    api_key: "",
    totp_token: "",
    default_quantity: 1, // Added to match registration form
    tradingsymbol: "",
    symboltoken: "3045",
    exchange: "NSE",
    strike_price: 0,
    producttype: "INTRADAY",
    buy_threshold_offset: 0,
    buy_percentage: 0,
    sell_threshold_offset: 0,
    sell_percentage: 0,
    stop_loss_type: "Fixed",
    stop_loss_value: 0,
    points_condition: 0,
  });

  const [ltpPrice, setLtpPrice] = useState(null);
  const [loadingLtp, setLoadingLtp] = useState(false);

  /********************************************************
   *                 API FUNCTIONS                      *
   ********************************************************/

  const fetchUsers = async () => {
    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/get_users", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      const data = await response.json();
      setUsers(data.users || []); // Ensure fallback to empty array
    } catch (error) {
      console.error("Error fetching users:", error);
      setMessage({ text: "Failed to fetch users", type: "danger" });
    }
  };

  const fetchOpenPositions = async () => {
    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/get_trades", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      const data = await response.json();
      setOpenTrades(data.trades || []); // Ensure fallback to empty array
    } catch (error) {
      console.error("Error fetching open positions:", error);
      setMessage({ text: "Failed to fetch open positions", type: "danger" });
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/register_user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: formData.username,
          password: formData.password,
          broker: formData.broker,
          api_key: formData.api_key,
          totp_token: formData.totp_token,
          default_quantity: parseInt(formData.default_quantity || 1, 10),
        }),
      });
      const data = await response.json();
      if (response.ok) {
        setMessage({ text: "User registered successfully!", type: "success" });
        fetchUsers();
        setFormData({
          username: "",
          password: "",
          broker: "Angel",
          api_key: "",
          totp_token: "",
          default_quantity: 1,
          tradingsymbol: "",
          symboltoken: "3045",
          exchange: "NSE",
          strike_price: 0,
          producttype: "INTRADAY",
          buy_threshold_offset: 0,
          buy_percentage: 0,
          sell_threshold_offset: 0,
          sell_percentage: 0,
          stop_loss_type: "Fixed",
          stop_loss_value: 0,
          points_condition: 0,
        });
        setShowRegisterModal(false);
      } else {
        setMessage({ text: data.detail || "Registration failed", type: "danger" });
      }
    } catch (error) {
      console.error("Error registering user:", error);
      setMessage({ text: "Server error. Try again later.", type: "danger" });
    }
  };

  const handleDeleteUser = async (username) => {
    try {
      const response = await fetch(`https://mtb-8ra9.onrender.com/api/delete_user/${username}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (response.ok) {
        setUsers(users.filter(user => user.username !== username));
        setMessage({ text: "User deleted successfully!", type: "success" });
      } else {
        setMessage({ text: data.detail || "Failed to delete user", type: "danger" });
      }
    } catch (error) {
      console.error("Error deleting user:", error);
      setMessage({ text: "Server error. Try again later.", type: "danger" });
    }
  };

  const handleInitiateTrade = async () => {
    if (!selectedUsers.length) {
      setMessage({ text: "Please select at least one user.", type: "warning" });
      return;
    }

    try {
      for (const username of selectedUsers) {
        const response = await fetch("https://mtb-8ra9.onrender.com/api/initiate_trade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            tradingsymbol: formData.tradingsymbol,
            symboltoken: formData.symboltoken,
            exchange: formData.exchange,
            strike_price: formData.strike_price,
            producttype: formData.producttype,
            buy_threshold_offset: actionType === 'buy' ? formData.buy_threshold_offset : null,
            buy_percentage: actionType === 'buy' ? formData.buy_percentage : null,
            sell_threshold_offset: actionType === 'sell' ? formData.sell_threshold_offset : null,
            sell_percentage: actionType === 'sell' ? formData.sell_percentage : null,
            stop_loss_type: formData.stop_loss_type,
            stop_loss_value: formData.stop_loss_value,
            points_condition: formData.points_condition,
          }),
        });

        const data = await response.json();
        if (response.ok) {
          setMessage({ text: `${actionType === 'buy' ? 'Buy' : 'Sell'} initiated successfully for ${username}!`, type: "success" });
          fetchOpenPositions();
        } else {
          setMessage({ text: `Failed to initiate ${actionType} for ${username}: ${data.detail}`, type: "danger" });
        }
      }
    } catch (error) {
      console.error("Error initiating trade:", error);
      setMessage({ text: "Server error initiating trade. Try again later.", type: "danger" });
    }
    setFormStep(1);
    setSelectedUsers([]);
    setActionType(null);
    setFormData({
      username: "",
      password: "",
      broker: "Angel",
      api_key: "",
      totp_token: "",
      default_quantity: 1,
      tradingsymbol: "",
      symboltoken: "3045",
      exchange: "NSE",
      strike_price: 0,
      producttype: "INTRADAY",
      buy_threshold_offset: 0,
      buy_percentage: 0,
      sell_threshold_offset: 0,
      sell_percentage: 0,
      stop_loss_type: "Fixed",
      stop_loss_value: 0,
      points_condition: 0,
    });
  };

  /********************************************************
   *                 SUB-COMPONENTS                     *
   ********************************************************/

  const UserActionsDropdown = ({ setShowRegisterModal, setShowUsers, showUsers }) => (
    <Dropdown as={ButtonGroup}>
      <Dropdown.Toggle variant="primary" id="dropdown-basic" className="user-actions-dropdown">
        <FontAwesomeIcon icon={faUserCog} />
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <Dropdown.Item onClick={() => setShowRegisterModal(true)}>
          <FontAwesomeIcon icon={faUserPlus} className="me-2" /> Register
        </Dropdown.Item>
        <Dropdown.Item onClick={() => { setShowUsers(!showUsers); fetchUsers(); }}>
          <FontAwesomeIcon icon={faUsers} className="me-2" /> View Users
        </Dropdown.Item>
        <Dropdown.Item onClick={() => window.open('https://www.angelone.in/login/?redirectUrl=account', '_blank')}>
          <FontAwesomeIcon icon={faSignInAlt} className="me-2" /> Angel Login
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );

  const AdvancedChart = ({ symbol, openTrades }) => {
    const chartContainerRef = useRef(null);
    const tvWidgetRef = useRef(null);

    useEffect(() => {
      const loadTradingViewScript = () => {
        if (window.TradingView) {
          initChart();
          return;
        }
        const script = document.createElement("script");
        script.src = "https://s3.tradingview.com/tv.js";
        script.async = true;
        script.onload = initChart;
        document.body.appendChild(script);
      };

      const initChart = () => {
        if (!window.TradingView) return;
        tvWidgetRef.current = new window.TradingView.widget({
          autosize: true,
          symbol: symbol || "NSE:SBIN",
          interval: "1",
          container_id: "advanced_chart_container",
          datafeed: window.TradingView.defaultDatafeed || {}, // Fallback for undefined defaultDatafeed
          library_path: "/charting_library/",
          locale: "en",
          disabled_features: ["header_saveload"],
          enabled_features: [],
          onChartReady: () => console.log("Advanced chart is ready"),
        });
      };

      loadTradingViewScript();

      return () => {
        if (tvWidgetRef.current) tvWidgetRef.current.remove();
      };
    }, [symbol]);

    useEffect(() => {
      if (tvWidgetRef.current && tvWidgetRef.current.chart) {
        updateMarkers(openTrades);
      }
    }, [openTrades, symbol]);

    const updateMarkers = (trades) => {
      if (!tvWidgetRef.current || !tvWidgetRef.current.chart) return;
      tvWidgetRef.current.chart().removeAllShapes();
      trades.forEach((trade) => {
        const time = Math.floor(Date.now() / 1000);
        tvWidgetRef.current.chart().createShape(
          { time, price: trade.entry_price },
          {
            shape: trade.position_type === "LONG" ? "arrow_up" : "arrow_down",
            text: `${trade.position_type === "LONG" ? "Buy" : "Sell"} by ${trade.username} at ${trade.entry_price}`,
            color: trade.position_type === "LONG" ? "green" : "red",
            disableUndo: true
          }
        );
      });
    };

    return <div id="advanced_chart_container" ref={chartContainerRef} style={{ height: "500px", width: "100%" }} />;
  };

  /********************************************************
   *                     RENDER (JSX)                     *
   ********************************************************/
  useEffect(() => {
    fetchUsers();
    fetchOpenPositions();
  }, []);

  return (
    <Container className="mt-4">
      {/* Message Alert at the top */}
      {message.text && (
        <Alert 
          variant={message.type} 
          className="mt-3 mb-3" 
          style={{ position: "relative", top: "10%" }}
        >
          {message.text}
        </Alert>
      )}

      {/* User Actions Dropdown */}
      <Row className="justify-content-end mb-3" style={{ position: "absolute", top: "9%", right: "10px", zIndex: "1000" }}>
        <Col xs="auto">
          <UserActionsDropdown setShowRegisterModal={setShowRegisterModal} setShowUsers={setShowUsers} showUsers={showUsers} />
        </Col>
      </Row>

      {/* Users Table */}
      {showUsers && (
        <Container className="users-table-container mb-5">
          <h3 className="text-center mb-4 text-primary">
            <FontAwesomeIcon icon={faUsers} className="me-2" /> Registered Users
          </h3>
          <div className="table-responsive">
            <Table striped bordered hover className="users-table shadow-sm">
              <thead>
                <tr>
                  <th className="table-header bg-primary text-white">#</th>
                  <th className="table-header bg-success text-white">Username</th>
                  <th className="table-header bg-info text-white">Role</th>
                  <th className="table-header bg-warning text-dark">Broker</th>
                  <th className="table-header bg-danger text-white">Default Quantity</th>
                  <th className="table-header bg-dark text-white">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length > 0 ? (
                  users.map((user, index) => (
                    <tr key={index}>
                      <td>{index + 1}</td>
                      <td>{user.username}</td>
                      <td>{user.role || "Trader"}</td>
                      <td>{user.broker}</td>
                      <td>{user.default_quantity}</td>
                      <td>
                        <Button variant="danger" size="sm" onClick={() => handleDeleteUser(user.username)}>
                          ❌ Delete
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="6" className="text-muted text-center">No registered users found.</td>
                  </tr>
                )}
              </tbody>
            </Table>
          </div>
        </Container>
      )}

      {/* Trades Dashboard */}
      {showTradesDashboard && (
        <>
          <Container className="mt-5 p-4 traders-table-container shadow-lg rounded bg-white">
            <h3 className="text-center mb-4 text-dark fw-bold">
              <FontAwesomeIcon icon={faExchangeAlt} className="me-2 text-primary" /> Active Trades
            </h3>
            <div className="table-responsive">
              <Table striped bordered hover className="traders-table shadow-sm">
                <thead className="text-center">
                  <tr>
                    <th>#</th>
                    <th className="bg-primary text-white"><FontAwesomeIcon icon={faUser} /> Username</th>
                    <th className="bg-success text-white"><FontAwesomeIcon icon={faUserTie} /> Role</th>
                    <th className="bg-info text-white"><FontAwesomeIcon icon={faChartLine} /> Symbol</th>
                    <th className="bg-dark text-white"><FontAwesomeIcon icon={faDollarSign} /> Entry Price</th>
                    <th className="bg-danger text-white"><FontAwesomeIcon icon={faChartBar} /> Threshold</th>
                    <th className="bg-secondary text-white"><FontAwesomeIcon icon={faHourglassHalf} /> Exit Type</th>
                    <th className="bg-primary text-white"><FontAwesomeIcon icon={faBullseye} /> Exit Value</th>
                    <th className="bg-warning text-dark"><FontAwesomeIcon icon={faMapMarkerAlt} /> Position</th>
                  </tr>
                </thead>
                <tbody>
                  {openTrades.length > 0 ? (
                    openTrades.map((trade, index) => (
                      <tr key={index} className="align-middle text-center">
                        <td><strong className="text-secondary">{index + 1}</strong></td>
                        <td className="fw-bold text-warning">{trade.username}</td>
                        <td><span className={`badge ${trade.user_role === "Admin" ? "bg-danger" : "bg-secondary"}`}>{trade.user_role}</span></td>
                        <td className="text-primary fw-bold">{trade.symbol}</td>
                        <td className="text-success fw-bold">₹{trade.entry_price}</td>
                        <td className="text-danger fw-bold">{trade.position_type === "LONG" ? trade.buy_threshold : trade.sell_threshold}</td>
                        <td className="text-warning">{trade.exit_condition_type}</td>
                        <td className="text-info">{trade.exit_condition_value}</td>
                        <td><span className={`badge ${trade.position_type === "LONG" ? "bg-success" : "bg-danger"}`}>{trade.position_type === "LONG" ? "Buy" : "Sell"}</span></td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="9" className="text-muted text-center">No active trades found.</td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          </Container>
          <Container className="mt-5 p-4 bg-light rounded shadow-lg">
            <h4 className="text-center mb-3 text-dark fw-bold">📊 Live Chart with Open Trades</h4>
            <AdvancedChart symbol={formData.tradingsymbol} openTrades={openTrades} />
          </Container>
        </>
      )}

      {/* Navigation Buttons */}
      <Row className="justify-content-center mb-3">
        <Col xs="auto">
          <Button onClick={() => window.open('https://www.angelone.in/trade/markets/equity/overview', '_blank')} className="gradient-button btn-market">
            Market Overview
          </Button>
        </Col>
        <Col xs="auto">
          <Button onClick={() => window.open('https://www.angelone.in/trade/indices/indian', '_blank')} className="gradient-button btn-indices">
            Indices
          </Button>
        </Col>
        <Col xs="auto">
          <Button onClick={() => window.open('https://www.angelone.in/trade/watchlist/chart', '_blank')} className="gradient-button btn-chart">
            Chart
          </Button>
        </Col>
        <Col xs="auto">
          <Button onClick={() => window.open('https://www.angelone.in/trade/watchlist/option-chain', '_blank')} className="gradient-button btn-option">
            Option Chain
          </Button>
        </Col>
        <Col xs="auto">
          <Button onClick={() => { setShowTradesDashboard(!showTradesDashboard); fetchOpenPositions(); }} className="gradient-button btn-trades">
            Trades Dashboard
          </Button>
        </Col>
      </Row>

      {/* Multi-Step Trade Form */}
      <Container className="mt-4 p-3 border rounded shadow-sm">
        {formStep === 1 && (
          <>
            <h4 className="text-primary">
              <FontAwesomeIcon icon={faUsers} /> Select Users (1 to 3)
            </h4>
            <Form>
              <Row className="mb-3">
                <Col>
                  {users.map((user, index) => (
                    <Form.Check
                      key={index}
                      type="checkbox"
                      label={user.username}
                      checked={selectedUsers.includes(user.username)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          if (selectedUsers.length < 3) {
                            setSelectedUsers([...selectedUsers, user.username]);
                          } else {
                            alert("⚠ You can only select up to 3 users.");
                          }
                        } else {
                          setSelectedUsers(selectedUsers.filter(u => u !== user.username));
                        }
                      }}
                    />
                  ))}
                </Col>
              </Row>
              <Button 
                variant="primary" 
                onClick={() => {
                  if (selectedUsers.length === 0) {
                    alert("Please select at least 1 user.");
                  } else {
                    setFormStep(2);
                  }
                }}
                className="mt-3"
              >
                Next
              </Button>
            </Form>
          </>
        )}

        {formStep === 2 && (
          <>
            <h4 className="text-primary">
              <FontAwesomeIcon icon={faBullseye} /> Set Trade Conditions
            </h4>
            <Form>
              <Row className="mb-3">
                <Col md={4}>
                  <Form.Group controlId="tradingsymbol">
                    <Form.Label>Trading Symbol</Form.Label>
                    <Form.Control 
                      type="text" 
                      placeholder="e.g., SBIN-EQ" 
                      value={formData.tradingsymbol} 
                      onChange={(e) => setFormData({ ...formData, tradingsymbol: e.target.value })}
                      required 
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group controlId="symboltoken">
                    <Form.Label>Symbol Token</Form.Label>
                    <Form.Control 
                      type="text" 
                      placeholder="e.g., 3045" 
                      value={formData.symboltoken} 
                      onChange={(e) => setFormData({ ...formData, symboltoken: e.target.value })}
                      required 
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group controlId="strike_price">
                    <Form.Label>Strike Price</Form.Label>
                    <Form.Control 
                      type="number" 
                      placeholder="e.g., 100" 
                      value={formData.strike_price} 
                      onChange={(e) => setFormData({ ...formData, strike_price: parseFloat(e.target.value) || 0 })}
                      required 
                    />
                  </Form.Group>
                </Col>
              </Row>
              <Row className="mb-3">
                <Col md={4}>
                  <Form.Group>
                    <Form.Label>Trade Type</Form.Label>
                    <div>
                      <Button 
                        variant={actionType === 'buy' ? "success" : "outline-success"} 
                        onClick={() => setActionType('buy')}
                        className="me-2"
                      >
                        Buy
                      </Button>
                      <Button 
                        variant={actionType === 'sell' ? "danger" : "outline-danger"} 
                        onClick={() => setActionType('sell')}
                      >
                        Sell
                      </Button>
                    </div>
                  </Form.Group>
                </Col>
                {actionType === 'buy' && (
                  <>
                    <Col md={4}>
                      <Form.Group controlId="buy_threshold_offset">
                        <Form.Label>Buy Threshold Offset</Form.Label>
                        <Form.Control 
                          type="number" 
                          placeholder="e.g., 10 for +10" 
                          value={formData.buy_threshold_offset} 
                          onChange={(e) => setFormData({ ...formData, buy_threshold_offset: parseFloat(e.target.value) || 0 })}
                        />
                      </Form.Group>
                    </Col>
                    <Col md={4}>
                      <Form.Group controlId="buy_percentage">
                        <Form.Label>Buy Percentage Increase (%)</Form.Label>
                        <Form.Control 
                          type="number" 
                          placeholder="e.g., 5 for 5%" 
                          value={formData.buy_percentage} 
                          onChange={(e) => setFormData({ ...formData, buy_percentage: parseFloat(e.target.value) || 0 })}
                        />
                      </Form.Group>
                    </Col>
                  </>
                )}
                {actionType === 'sell' && (
                  <>
                    <Col md={4}>
                      <Form.Group controlId="sell_threshold_offset">
                        <Form.Label>Sell Threshold Offset</Form.Label>
                        <Form.Control 
                          type="number" 
                          placeholder="e.g., -10 for -10" 
                          value={formData.sell_threshold_offset} 
                          onChange={(e) => setFormData({ ...formData, sell_threshold_offset: parseFloat(e.target.value) || 0 })}
                        />
                      </Form.Group>
                    </Col>
                    <Col md={4}>
                      <Form.Group controlId="sell_percentage">
                        <Form.Label>Sell Percentage Decrease (%)</Form.Label>
                        <Form.Control 
                          type="number" 
                          placeholder="e.g., 5 for 5%" 
                          value={formData.sell_percentage} 
                          onChange={(e) => setFormData({ ...formData, sell_percentage: parseFloat(e.target.value) || 0 })}
                        />
                      </Form.Group>
                    </Col>
                  </>
                )}
              </Row>
              <Row className="mb-3">
                <Col md={4}>
                  <Form.Group controlId="stop_loss_type">
                    <Form.Label>Exit Condition Type</Form.Label>
                    <Form.Select 
                      value={formData.stop_loss_type} 
                      onChange={(e) => setFormData({ ...formData, stop_loss_type: e.target.value })}
                    >
                      <option value="Fixed">Fixed</option>
                      <option value="Percentage">Percentage</option>
                      <option value="Points">Points</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group controlId="stop_loss_value">
                    <Form.Label>Exit Condition Value</Form.Label>
                    <Form.Control 
                      type="number" 
                      placeholder="e.g., 5 or 50%" 
                      value={formData.stop_loss_value} 
                      onChange={(e) => setFormData({ ...formData, stop_loss_value: parseFloat(e.target.value) || 0 })}
                      required 
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group controlId="points_condition">
                    <Form.Label>Points Condition</Form.Label>
                    <Form.Control 
                      type="number" 
                      placeholder="e.g., 0 or -0.2" 
                      value={formData.points_condition} 
                      onChange={(e) => setFormData({ ...formData, points_condition: parseFloat(e.target.value) || 0 })}
                    />
                  </Form.Group>
                </Col>
              </Row>
              <Button 
                variant="primary" 
                onClick={() => actionType ? setFormStep(3) : alert("Please select Buy or Sell.")}
                className="mt-3"
              >
                Next
              </Button>
              <Button 
                variant="secondary" 
                onClick={() => { setFormStep(1); setSelectedUsers([]); setActionType(null); }}
                className="mt-3 ms-2"
              >
                Back
              </Button>
            </Form>
          </>
        )}

        {formStep === 3 && (
          <>
            <h4 className={actionType === 'buy' ? "text-success" : "text-danger"}>
              <FontAwesomeIcon icon={actionType === 'buy' ? faShoppingCart : faExchangeAlt} /> Confirm {actionType === 'buy' ? 'Buy' : 'Sell'}
            </h4>
            <Form>
              <Row className="mb-3">
                <Col>
                  <p><strong>Selected Users:</strong> {selectedUsers.join(", ") || "None"}</p>
                  <p><strong>Symbol:</strong> {formData.tradingsymbol}</p>
                  <p><strong>Strike Price:</strong> ₹{formData.strike_price}</p>
                  <p><strong>{actionType === 'buy' ? 'Buy' : 'Sell'} Threshold:</strong> {actionType === 'buy' ? 
                    (formData.buy_threshold_offset ? `≥ ${formData.strike_price + formData.buy_threshold_offset}` : 
                     formData.buy_percentage ? `≥ ${formData.strike_price * (1 + formData.buy_percentage/100)}` : "None") : 
                    (formData.sell_threshold_offset ? `≤ ${formData.strike_price + formData.sell_threshold_offset}` : 
                     formData.sell_percentage ? `≤ ${formData.strike_price * (1 - formData.sell_percentage/100)}` : "None")}</p>
                  <p><strong>Exit Condition:</strong> {formData.stop_loss_type} at {formData.stop_loss_value} {formData.stop_loss_type === "Percentage" ? "%" : ""} (Points: {formData.points_condition})</p>
                  {ltpPrice && <p><strong>Current LTP:</strong> ₹{ltpPrice}</p>}
                </Col>
              </Row>
              <Button 
                variant={actionType === 'buy' ? "success" : "danger"} 
                onClick={handleInitiateTrade}
                className="mt-3"
                disabled={loadingLtp || !ltpPrice} // Note: LTP fetch logic is missing; button remains disabled without it
              >
                Confirm {actionType === 'buy' ? 'Buy' : 'Sell'}
              </Button>
              <Button 
                variant="secondary" 
                onClick={() => setFormStep(2)}
                className="mt-3 ms-2"
              >
                Back
              </Button>
            </Form>
          </>
        )}
      </Container>

      {/* Registration Modal */}
      <Modal show={showRegisterModal} onHide={() => setShowRegisterModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Register User</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {message.text && <Alert variant={message.type}>{message.text}</Alert>}
          <Form onSubmit={handleRegisterSubmit}>
            <Form.Group controlId="username">
              <Form.Label>Username</Form.Label>
              <Form.Control 
                type="text" 
                placeholder="Enter username" 
                value={formData.username} 
                onChange={(e) => setFormData({ ...formData, username: e.target.value })} 
                required 
              />
            </Form.Group>
            <Form.Group controlId="password">
              <Form.Label>Password</Form.Label>
              <Form.Control 
                type="password" 
                placeholder="Enter password" 
                value={formData.password} 
                onChange={(e) => setFormData({ ...formData, password: e.target.value })} 
                required 
              />
            </Form.Group>
            <Form.Group controlId="broker">
              <Form.Label>Broker</Form.Label>
              <Form.Select 
                value={formData.broker} 
                onChange={(e) => setFormData({ ...formData, broker: e.target.value })}
              >
                <option value="Angel">Angel</option>
                <option value="Zerodha">Zerodha</option>
              </Form.Select>
            </Form.Group>
            <Form.Group controlId="api_key">
              <Form.Label>API Key</Form.Label>
              <Form.Control 
                type="text" 
                placeholder="Enter API Key" 
                value={formData.api_key} 
                onChange={(e) => setFormData({ ...formData, api_key: e.target.value })} 
                required 
              />
            </Form.Group>
            <Form.Group controlId="totp_token">
              <Form.Label>TOTP Token</Form.Label>
              <Form.Control 
                type="text" 
                placeholder="Enter TOTP Token" 
                value={formData.totp_token} 
                onChange={(e) => setFormData({ ...formData, totp_token: e.target.value })} 
                required 
              />
            </Form.Group>
            <Form.Group controlId="default_quantity">
              <Form.Label>Default Quantity</Form.Label>
              <Form.Control 
                type="number" 
                placeholder="Enter Quantity" 
                value={formData.default_quantity} 
                onChange={(e) => setFormData({ ...formData, default_quantity: e.target.value })} 
                required 
              />
            </Form.Group>
            <Button variant="primary" type="submit" className="mt-3">Register</Button>
          </Form>
        </Modal.Body>
      </Modal>
    </Container>
  );
};

export default Landing;